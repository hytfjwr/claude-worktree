import { basename, join } from "node:path";

import type {
  AheadBehind,
  CommitInfo,
  GitContext,
  ListWorktreesResult,
  ParsedWorktree,
  WorktreeInfo,
  WorktreeStatus,
} from "../types/index.ts";
import { promiseAllLimit } from "./concurrency.ts";
import { GitError } from "./errors.ts";
import { exec } from "./exec.ts";

export async function getGitContext(): Promise<GitContext> {
  let repoRoot: string;
  try {
    repoRoot = (await exec("git", ["rev-parse", "--show-toplevel"]).text()).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Distinguish "not a git repo" from other failures (e.g., git not installed)
    if (message.includes("not a git repository") || message.includes("ENOENT")) {
      throw new GitError(
        `Not in a git repository (cwd: ${process.cwd()})\n\n` +
          "Navigate to a git repository and try again:\n" +
          "  cd /path/to/your/repo",
      );
    }
    throw new GitError(`Failed to detect git repository: ${message}`);
  }
  if (!repoRoot) {
    throw new GitError(
      `Not in a git repository (cwd: ${process.cwd()})\n\n` +
        "Navigate to a git repository and try again:\n" +
        "  cd /path/to/your/repo",
    );
  }

  const currentBranch = (await exec("git", ["branch", "--show-current"]).text()).trim();
  if (!currentBranch) {
    throw new GitError("Could not determine current branch. You may be in a detached HEAD state.");
  }

  return {
    repoRoot,
    repoName: basename(repoRoot),
    currentBranch,
  };
}

export function getWorktreePath(repoRoot: string, repoName: string, branchName: string): string {
  return join(repoRoot, "..", `${repoName}-${branchName.replace(/\//g, "-")}`);
}

export function buildWorktreeCommand(branchName: string, worktreePath: string, baseBranch: string): string {
  return `git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`;
}

export async function createWorktree(branchName: string, worktreePath: string, baseBranch: string): Promise<void> {
  const result = await exec("git", ["worktree", "add", "-b", branchName, worktreePath, baseBranch]).nothrow().quiet();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new GitError(`Failed to create worktree: ${stderr}`);
  }
}

/**
 * Pure function to extract the main branch name from `git branch -a` output.
 */
export function extractMainBranchName(branchList: string): string {
  const branchLines = branchList
    .trim()
    .split("\n")
    .map((b) => b.trim().replace(/^\* /, ""));
  if (branchLines.some((b) => b === "remotes/origin/main" || b === "main")) {
    return "main";
  }
  if (branchLines.some((b) => b === "remotes/origin/master" || b === "master")) {
    return "master";
  }
  return "main"; // Ultimate fallback
}

export async function getMainBranch(): Promise<string> {
  // Try to detect the main branch name
  const result = await exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD"]).nothrow().quiet();
  if (result.exitCode === 0) {
    const ref = result.text().trim();
    // refs/remotes/origin/main -> main
    return ref.replace("refs/remotes/origin/", "");
  }

  // Fallback: check if main or master exists
  const branchResult = await exec("git", ["branch", "-a"]).nothrow().quiet();
  if (branchResult.exitCode !== 0) {
    return "main"; // Default fallback
  }
  return extractMainBranchName(branchResult.text());
}

/**
 * Pure function to parse git worktree list --porcelain output.
 */
export function parseWorktreePorcelain(output: string, mainBranch: string): ParsedWorktree[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  const worktrees: ParsedWorktree[] = [];
  const entries = trimmed.split("\n\n");

  for (const entry of entries) {
    const lines = entry.split("\n");
    let path = "";
    let branch: string | null = null;
    let isLocked = false;
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.substring(9);
      } else if (line.startsWith("branch ")) {
        // refs/heads/feature/xxx -> feature/xxx
        branch = line.substring(7).replace("refs/heads/", "");
      } else if (line === "locked") {
        isLocked = true;
      } else if (line === "bare") {
        isBare = true;
      }
    }

    // Check if this is the main worktree (has main/master branch or is bare)
    const isMain = isBare || branch === mainBranch;

    if (path) {
      worktrees.push({ path, branch, isLocked, isMain });
    }
  }

  return worktrees;
}

export async function listWorktrees(): Promise<ListWorktreesResult> {
  const result = await exec("git", ["worktree", "list", "--porcelain"]).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new GitError("Failed to list worktrees. Are you in a git repository?");
  }
  const output = result.text().trim();
  const mainBranch = await getMainBranch();
  if (!output) {
    return { worktrees: [], mainBranch };
  }

  const parsed = parseWorktreePorcelain(output, mainBranch);

  const worktrees = await promiseAllLimit(
    parsed.map((p) => async () => ({ ...p, isDirty: await isWorktreeDirty(p.path) })),
  );

  return { worktrees, mainBranch };
}

export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const result = await exec("git", ["-C", worktreePath, "status", "--porcelain"]).nothrow().quiet();
  if (result.exitCode !== 0) {
    return true; // Treat as dirty if we can't check
  }
  return result.text().trim().length > 0;
}

export async function isBranchMerged(branch: string, baseBranch?: string): Promise<boolean> {
  const base = baseBranch || (await getMainBranch());

  // Check if branch is merged into base
  const result = await exec("git", ["branch", "--merged", base]).nothrow().quiet();
  if (result.exitCode !== 0) {
    return false;
  }

  const mergedBranches = result
    .text()
    .trim()
    .split("\n")
    .map((b: string) => b.trim().replace("* ", ""));
  return mergedBranches.includes(branch);
}

/**
 * Get branches that have remote tracking references (refs/remotes/origin/*).
 * Call this BEFORE fetchAndPrune() to capture which branches were previously on remote.
 */
export async function getRemoteTrackingBranches(): Promise<Set<string>> {
  const result = await exec("git", ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"])
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    return new Set();
  }
  const branches = result
    .text()
    .trim()
    .split("\n")
    .filter((b) => b.length > 0)
    .map((b) => b.replace(/^origin\//, ""));
  // Exclude HEAD pointer (e.g. "origin/HEAD" -> "HEAD")
  return new Set(branches.filter((b) => b !== "HEAD"));
}

/**
 * Fetch all remote branch names in a single `git ls-remote --heads origin` call.
 * Returns a Set of branch names (e.g. "main", "feature/foo").
 */
export async function getRemoteBranches(): Promise<Set<string>> {
  const result = await exec("git", ["ls-remote", "--heads", "origin"]).timeout(30_000).nothrow().quiet();
  if (result.exitCode !== 0) {
    return new Set();
  }
  const branches = result
    .text()
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/.*refs\/heads\//, ""));
  return new Set(branches);
}

/**
 * Pure function: check if a branch was deleted from remote using pre-fetched data.
 * No network call — O(1) lookup.
 */
export function isRemoteBranchDeletedFrom(
  branch: string,
  trackedBranches: Set<string>,
  remoteBranches: Set<string>,
): boolean {
  if (!trackedBranches.has(branch)) return false;
  return !remoteBranches.has(branch);
}

export async function isRemoteBranchDeleted(branch: string, trackedBranches: Set<string>): Promise<boolean> {
  // If the branch was never tracked on remote, it's not "remote deleted"
  if (!trackedBranches.has(branch)) {
    return false;
  }
  // Check if remote branch still exists
  const result = await exec("git", ["ls-remote", "--heads", "origin", branch]).nothrow().quiet();
  if (result.exitCode !== 0) {
    return true; // Assume deleted if we can't check
  }
  return result.text().trim().length === 0;
}

/**
 * Count commits that exist locally but haven't been pushed to origin/<branch>.
 * Returns null if origin/<branch> doesn't exist (branch never pushed or remote ref pruned).
 */
export async function getUnpushedCommitCount(worktreePath: string, branch: string): Promise<number | null> {
  const result = await exec("git", ["-C", worktreePath, "rev-list", "--count", `origin/${branch}..HEAD`])
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  const count = Number.parseInt(result.text().trim(), 10);
  return Number.isNaN(count) ? null : count;
}

export async function removeWorktree(worktreePath: string, force = false): Promise<void> {
  if (force) {
    await exec("git", ["worktree", "remove", "--force", worktreePath]);
  } else {
    await exec("git", ["worktree", "remove", worktreePath]);
  }
}

export async function findWorktreeByBranch(branchName: string): Promise<WorktreeInfo | null> {
  const { worktrees } = await listWorktrees();
  return worktrees.find((w) => w.branch === branchName) || null;
}

export async function deleteLocalBranch(branchName: string, force = false): Promise<void> {
  const flag = force ? "-D" : "-d";
  const result = await exec("git", ["branch", flag, branchName]).nothrow().quiet();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new GitError(`Failed to delete branch ${branchName}: ${stderr}`);
  }
}

/**
 * Pure function to parse `git log -1 --format=%H%x00%s%x00%aI` output.
 */
export function parseCommitLog(output: string): CommitInfo | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  const [hash, message, dateStr] = trimmed.split("\0");
  if (!hash || !message || !dateStr) {
    return null;
  }
  return { hash, message, date: new Date(dateStr) };
}

export async function getLastCommit(worktreePath: string): Promise<CommitInfo | null> {
  const result = await exec("git", ["-C", worktreePath, "log", "-1", "--format=%H%x00%s%x00%aI"]).nothrow().quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  return parseCommitLog(result.text());
}

/**
 * Pure function to parse `git rev-list --left-right --count` output.
 */
export function parseAheadBehind(output: string): AheadBehind | null {
  const trimmed = output.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) {
    return null;
  }
  const ahead = Number.parseInt(parts[0], 10);
  const behind = Number.parseInt(parts[1], 10);
  if (Number.isNaN(ahead) || Number.isNaN(behind)) {
    return null;
  }
  return { ahead, behind };
}

export async function getAheadBehind(branch: string, baseBranch: string): Promise<AheadBehind | null> {
  const result = await exec("git", ["rev-list", "--left-right", "--count", `${branch}...${baseBranch}`])
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  return parseAheadBehind(result.text());
}

export async function fetchAndPrune(): Promise<void> {
  await exec("git", ["fetch", "--prune"]).timeout(30_000).quiet();
}

export async function fetchOrigin(branch?: string): Promise<void> {
  const args = branch ? ["fetch", "origin", branch] : ["fetch", "origin"];
  const result = await exec("git", args).timeout(30_000).nothrow().quiet();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new GitError(`Failed to fetch from origin: ${stderr}`);
  }
}

export async function branchExists(branchName: string): Promise<boolean> {
  const result = await exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`])
    .nothrow()
    .quiet();
  return result.exitCode === 0;
}

/**
 * Verify that a branch or ref exists (resolves to a valid commit).
 * Uses `git rev-parse --verify` which works for both local and remote refs.
 */
export async function verifyBranchRef(ref: string): Promise<boolean> {
  const result = await exec("git", ["rev-parse", "--verify", ref]).nothrow().quiet();
  return result.exitCode === 0;
}

export async function getWorktreeStatuses(
  worktrees: WorktreeInfo[],
  mainBranch: string,
  trackedBranches?: Set<string>,
  remoteBranches?: Set<string>,
): Promise<WorktreeStatus[]> {
  const effectiveTracked = trackedBranches ?? new Set<string>();
  return promiseAllLimit(
    worktrees.map((worktree) => async (): Promise<WorktreeStatus> => {
      if (worktree.isMain) {
        return {
          worktree,
          branchMerged: false,
          branchDeletedOnRemote: false,
          canAutoClean: false,
          reason: "Main worktree",
        };
      }

      if (worktree.isLocked) {
        return {
          worktree,
          branchMerged: false,
          branchDeletedOnRemote: false,
          canAutoClean: false,
          reason: "Locked",
        };
      }

      // Use batched remoteBranches (sync) when available, otherwise fall back to per-branch network call
      const branchDeletedOnRemote = worktree.branch
        ? remoteBranches
          ? isRemoteBranchDeletedFrom(worktree.branch, effectiveTracked, remoteBranches)
          : await isRemoteBranchDeleted(worktree.branch, effectiveTracked)
        : false;

      const branchMerged = worktree.branch ? await isBranchMerged(worktree.branch, mainBranch) : false;

      // Dirty worktrees that are not merged and not remote-deleted cannot be auto-cleaned.
      // But dirty worktrees whose branch is merged or remote-deleted are still auto-cleanable.
      if (worktree.isDirty && !branchMerged && !branchDeletedOnRemote) {
        return {
          worktree,
          branchMerged: false,
          branchDeletedOnRemote: false,
          canAutoClean: false,
          reason: "Has uncommitted changes",
        };
      }

      const canAutoClean = branchMerged || branchDeletedOnRemote;
      const dirtySuffix = worktree.isDirty ? " (dirty)" : "";

      let reason = "";
      if (branchMerged && branchDeletedOnRemote) {
        reason = `Merged & remote deleted${dirtySuffix}`;
      } else if (branchMerged) {
        reason = `Merged${dirtySuffix}`;
      } else if (branchDeletedOnRemote) {
        reason = `Remote deleted${dirtySuffix}`;
      } else {
        reason = "Active";
      }

      return {
        worktree,
        branchMerged,
        branchDeletedOnRemote,
        canAutoClean,
        reason,
      };
    }),
  );
}
