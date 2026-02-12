import { basename, join } from "node:path";

import type {
  AheadBehind,
  CommitInfo,
  GitContext,
  ListWorktreesResult,
  ParsedWorktree,
  WorktreeInfo,
  WorktreeStatus,
} from "../types.ts";
import { exec } from "./exec.ts";

const CONCURRENCY_LIMIT = 5;

/**
 * Run async task factories with a concurrency limit.
 * Each element in `tasks` is a zero-arg function that returns a Promise.
 */
async function promiseAllSettledLimit<T>(tasks: Array<() => Promise<T>>, limit = CONCURRENCY_LIMIT): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

export async function getGitContext(): Promise<GitContext> {
  let repoRoot: string;
  try {
    repoRoot = (await exec("git", ["rev-parse", "--show-toplevel"]).text()).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Distinguish "not a git repo" from other failures (e.g., git not installed)
    if (message.includes("not a git repository") || message.includes("ENOENT")) {
      throw new Error(
        `Not in a git repository (cwd: ${process.cwd()})\n\n` +
          "Navigate to a git repository and try again:\n" +
          "  cd /path/to/your/repo",
      );
    }
    throw new Error(`Failed to detect git repository: ${message}`);
  }
  if (!repoRoot) {
    throw new Error(
      `Not in a git repository (cwd: ${process.cwd()})\n\n` +
        "Navigate to a git repository and try again:\n" +
        "  cd /path/to/your/repo",
    );
  }

  const currentBranch = (await exec("git", ["branch", "--show-current"]).text()).trim();
  if (!currentBranch) {
    throw new Error("Could not determine current branch. You may be in a detached HEAD state.");
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
    throw new Error(`Failed to create worktree: ${stderr}`);
  }
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
  const branches = branchResult.text().trim();
  if (branches.includes("remotes/origin/main") || branches.includes(" main")) {
    return "main";
  }
  return "master";
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
    throw new Error("Failed to list worktrees. Are you in a git repository?");
  }
  const output = result.text().trim();
  const mainBranch = await getMainBranch();
  if (!output) {
    return { worktrees: [], mainBranch };
  }

  const parsed = parseWorktreePorcelain(output, mainBranch);

  const worktrees = await promiseAllSettledLimit(
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

export async function isRemoteBranchDeleted(branch: string): Promise<boolean> {
  // Check if remote branch exists
  const result = await exec("git", ["ls-remote", "--heads", "origin", branch]).nothrow().quiet();
  if (result.exitCode !== 0) {
    return true; // Assume deleted if we can't check
  }
  return result.text().trim().length === 0;
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
    throw new Error(`Failed to delete branch ${branchName}: ${stderr}`);
  }
}

export async function getLastCommit(worktreePath: string): Promise<CommitInfo | null> {
  const result = await exec("git", ["-C", worktreePath, "log", "-1", "--format=%h%x00%s%x00%aI"]).nothrow().quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  const output = result.text().trim();
  if (!output) {
    return null;
  }
  const [hash, message, dateStr] = output.split("\0");
  if (!hash || !message || !dateStr) {
    return null;
  }
  return { hash, message, date: new Date(dateStr) };
}

export async function getAheadBehind(branch: string, baseBranch: string): Promise<AheadBehind | null> {
  const result = await exec("git", ["rev-list", "--left-right", "--count", `${branch}...${baseBranch}`])
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  const output = result.text().trim();
  const parts = output.split(/\s+/);
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

export async function fetchAndPrune(): Promise<void> {
  await exec("git", ["fetch", "--prune"]).quiet();
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

export async function getWorktreeStatuses(worktrees: WorktreeInfo[], mainBranch: string): Promise<WorktreeStatus[]> {
  return promiseAllSettledLimit(
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

      if (worktree.isDirty) {
        return {
          worktree,
          branchMerged: false,
          branchDeletedOnRemote: false,
          canAutoClean: false,
          reason: "Has uncommitted changes",
        };
      }

      const [branchMerged, branchDeletedOnRemote] = await Promise.all([
        worktree.branch ? isBranchMerged(worktree.branch, mainBranch) : false,
        worktree.branch ? isRemoteBranchDeleted(worktree.branch) : false,
      ]);
      const canAutoClean = branchMerged || branchDeletedOnRemote;

      let reason = "";
      if (branchMerged && branchDeletedOnRemote) {
        reason = "Merged & remote deleted";
      } else if (branchMerged) {
        reason = "Merged";
      } else if (branchDeletedOnRemote) {
        reason = "Remote deleted";
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
