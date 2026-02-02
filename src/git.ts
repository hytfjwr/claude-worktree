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

export async function getMainBranch(): Promise<string> {
  // Try to detect the main branch name
  const result = await $`git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null`.quiet();
  if (result.exitCode === 0) {
    const ref = result.text().trim();
    // refs/remotes/origin/main -> main
    return ref.replace("refs/remotes/origin/", "");
  }

  // Fallback: check if main or master exists
  const branches = (await $`git branch -a`.text()).trim();
  if (branches.includes("remotes/origin/main") || branches.includes(" main")) {
    return "main";
  }
  return "master";
}

export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const output = (await $`git worktree list --porcelain`.text()).trim();
  if (!output) {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  const entries = output.split("\n\n");
  const mainBranch = await getMainBranch();

  for (const entry of entries) {
    const lines = entry.split("\n");
    let path = "";
    let branch: string | null = null;
    let isLocked = false;
    let isMain = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.substring(9);
      } else if (line.startsWith("branch ")) {
        // refs/heads/feature/xxx -> feature/xxx
        branch = line.substring(7).replace("refs/heads/", "");
      } else if (line === "locked") {
        isLocked = true;
      } else if (line === "bare") {
        isMain = true;
      }
    }

    // Check if this is the main worktree (has main/master branch)
    if (branch === mainBranch) {
      isMain = true;
    }

    const isDirty = path ? await isWorktreeDirty(path) : false;

    if (path) {
      worktrees.push({ path, branch, isLocked, isDirty, isMain });
    }
  }

  return worktrees;
}

export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const result = await $`git -C ${worktreePath} status --porcelain`.quiet();
  if (result.exitCode !== 0) {
    return true; // Treat as dirty if we can't check
  }
  return result.text().trim().length > 0;
}

export async function isBranchMerged(branch: string, baseBranch?: string): Promise<boolean> {
  const base = baseBranch || await getMainBranch();

  // Check if branch is merged into base
  const result = await $`git branch --merged ${base}`.quiet();
  if (result.exitCode !== 0) {
    return false;
  }

  const mergedBranches = result.text().trim().split("\n").map(b => b.trim().replace("* ", ""));
  return mergedBranches.includes(branch);
}

export async function isRemoteBranchDeleted(branch: string): Promise<boolean> {
  // Check if remote branch exists
  const result = await $`git ls-remote --heads origin ${branch}`.quiet();
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

export async function fetchAndPrune(): Promise<void> {
  await $`git fetch --prune`.quiet();
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
