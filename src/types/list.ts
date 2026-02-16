import type { AheadBehind, CommitInfo, ListWorktreesResult, WorktreeInfo, WorktreeStatus } from "./git.ts";
import type { SessionInfo, SessionState } from "./session.ts";
import type { Spinner } from "./spinner.ts";
import type { WeztermPane } from "./wezterm.ts";

export type ListArgs = {
  json: boolean;
  verbose: boolean;
  noStatus: boolean;
};

export type WorktreeListEntry = {
  worktree: WorktreeInfo;
  status: WorktreeStatus;
  commit: CommitInfo | null;
  aheadBehind: AheadBehind | null;
  session?: SessionState;
};

export type ListResult = {
  entries: WorktreeListEntry[];
};

export type ListDeps = {
  getRemoteTrackingBranches: () => Promise<Set<string>>;
  fetchAndPrune: () => Promise<void>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  getWorktreeStatuses: (
    worktrees: WorktreeInfo[],
    mainBranch: string,
    trackedBranches?: Set<string>,
  ) => Promise<WorktreeStatus[]>;
  getLastCommit: (worktreePath: string) => Promise<CommitInfo | null>;
  getAheadBehind: (branch: string, baseBranch: string) => Promise<AheadBehind | null>;
  startSpinner: (message: string) => Spinner;
  readAllSessions: () => Promise<Record<string, SessionInfo>>;
  listWeztermPanes: () => Promise<WeztermPane[] | null>;
};
