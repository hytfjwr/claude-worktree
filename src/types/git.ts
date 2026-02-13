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

export type ParsedWorktree = Omit<WorktreeInfo, "isDirty">;

export type ListWorktreesResult = {
  worktrees: WorktreeInfo[];
  mainBranch: string;
};

export type CommitInfo = {
  hash: string;
  message: string;
  date: Date;
};

export type AheadBehind = {
  ahead: number;
  behind: number;
};
