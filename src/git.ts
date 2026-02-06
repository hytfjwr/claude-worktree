import { $ } from "bun";
import { join, basename } from "path";

export type GitContext = {
  repoRoot: string;
  repoName: string;
  currentBranch: string;
};

export type WorktreeInfo = {
  path: string;
  branch: string | null;
  isLocked: boolean;
  isDirty: boolean;
  isMain: boolean;
};

export type WorktreeStatus = {
  worktree: WorktreeInfo;
  branchMerged: boolean;
  branchDeletedOnRemote: boolean;
  canAutoClean: boolean;
  reason: string;
};

export async function getGitContext(): Promise<GitContext> {
  const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
  if (!repoRoot) {
    throw new Error("Not in a git repository");
  }

  const currentBranch = (await $`git branch --show-current`.text()).trim();
  if (!currentBranch) {
    throw new Error("Could not determine current branch");
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

export async function createWorktree(
  branchName: string,
  worktreePath: string,
  baseBranch: string
): Promise<void> {
  const result = await $`git worktree add -b ${branchName} ${worktreePath} ${baseBranch}`
    .nothrow().quiet();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to create worktree: ${stderr}`);
  }
}

export async function getMainBranch(): Promise<string> {
  // Try to detect the main branch name
  const result = await $`git symbolic-ref refs/remotes/origin/HEAD`.nothrow().quiet();
  if (result.exitCode === 0) {
    const ref = result.text().trim();
    // refs/remotes/origin/main -> main
    return ref.replace("refs/remotes/origin/", "");
  }

  // Fallback: check if main or master exists
  const branchResult = await $`git branch -a`.nothrow().quiet();
  if (branchResult.exitCode !== 0) {
    return "main"; // Default fallback
  }
  const branches = branchResult.text().trim();
  if (branches.includes("remotes/origin/main") || branches.includes(" main")) {
    return "main";
  }
  return "master";
}

export type ParsedWorktree = Omit<WorktreeInfo, "isDirty">;

/**
 * git worktree list --porcelain の出力をパースする純粋関数
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

export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const result = await $`git worktree list --porcelain`.nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error("Failed to list worktrees. Are you in a git repository?");
  }
  const output = result.text().trim();
  if (!output) {
    return [];
  }

  const mainBranch = await getMainBranch();
  const parsed = parseWorktreePorcelain(output, mainBranch);

  const worktrees: WorktreeInfo[] = [];
  for (const p of parsed) {
    const isDirty = await isWorktreeDirty(p.path);
    worktrees.push({ ...p, isDirty });
  }

  return worktrees;
}

export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const result = await $`git -C ${worktreePath} status --porcelain`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return true; // Treat as dirty if we can't check
  }
  return result.text().trim().length > 0;
}

export async function isBranchMerged(branch: string, baseBranch?: string): Promise<boolean> {
  const base = baseBranch || await getMainBranch();

  // Check if branch is merged into base
  const result = await $`git branch --merged ${base}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return false;
  }

  const mergedBranches = result.text().trim().split("\n").map((b: string) => b.trim().replace("* ", ""));
  return mergedBranches.includes(branch);
}

export async function isRemoteBranchDeleted(branch: string): Promise<boolean> {
  // Check if remote branch exists
  const result = await $`git ls-remote --heads origin ${branch}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return true; // Assume deleted if we can't check
  }
  return result.text().trim().length === 0;
}

export async function removeWorktree(worktreePath: string, force = false): Promise<void> {
  if (force) {
    await $`git worktree remove --force ${worktreePath}`;
  } else {
    await $`git worktree remove ${worktreePath}`;
  }
}

export async function findWorktreeByBranch(branchName: string): Promise<WorktreeInfo | null> {
  const worktrees = await listWorktrees();
  return worktrees.find((w) => w.branch === branchName) || null;
}

export async function deleteLocalBranch(branchName: string, force = false): Promise<void> {
  const flag = force ? "-D" : "-d";
  const result = await $`git branch ${flag} ${branchName}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to delete branch ${branchName}: ${stderr}`);
  }
}

export async function fetchAndPrune(): Promise<void> {
  await $`git fetch --prune`.quiet();
}

export async function branchExists(branchName: string): Promise<boolean> {
  const result = await $`git show-ref --verify --quiet refs/heads/${branchName}`.nothrow().quiet();
  return result.exitCode === 0;
}

export async function getWorktreeStatuses(worktrees: WorktreeInfo[]): Promise<WorktreeStatus[]> {
  const statuses: WorktreeStatus[] = [];

  for (const worktree of worktrees) {
    if (worktree.isMain) {
      statuses.push({
        worktree,
        branchMerged: false,
        branchDeletedOnRemote: false,
        canAutoClean: false,
        reason: "メインworktree",
      });
      continue;
    }

    if (worktree.isLocked) {
      statuses.push({
        worktree,
        branchMerged: false,
        branchDeletedOnRemote: false,
        canAutoClean: false,
        reason: "ロック中",
      });
      continue;
    }

    if (worktree.isDirty) {
      statuses.push({
        worktree,
        branchMerged: false,
        branchDeletedOnRemote: false,
        canAutoClean: false,
        reason: "未コミットの変更あり",
      });
      continue;
    }

    const branchMerged = worktree.branch ? await isBranchMerged(worktree.branch) : false;
    const branchDeletedOnRemote = worktree.branch ? await isRemoteBranchDeleted(worktree.branch) : false;
    const canAutoClean = branchMerged || branchDeletedOnRemote;

    let reason = "";
    if (branchMerged && branchDeletedOnRemote) {
      reason = "マージ済み & リモート削除済み";
    } else if (branchMerged) {
      reason = "マージ済み";
    } else if (branchDeletedOnRemote) {
      reason = "リモート削除済み";
    } else {
      reason = "アクティブ";
    }

    statuses.push({
      worktree,
      branchMerged,
      branchDeletedOnRemote,
      canAutoClean,
      reason,
    });
  }

  return statuses;
}
