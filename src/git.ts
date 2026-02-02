import { $ } from "bun";
import { join, basename } from "path";

export interface GitContext {
  repoRoot: string;
  repoName: string;
  currentBranch: string;
}

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
