import type { AheadBehind, CommitInfo, ListWorktreesResult, WorktreeInfo, WorktreeStatus } from "./git.ts";
import type { SessionInfo, SessionState } from "./session.ts";
import type { Spinner } from "./spinner.ts";
import type { HerdrPane, TmuxPane, WeztermPane } from "./wezterm.ts";

export type ListArgs = {
  json: boolean;
  verbose: boolean;
  noStatus: boolean;
  quiet: boolean;
  fetch: boolean;
  /** Live-refresh mode (-watch): redraw the list until the user quits. */
  watch?: boolean;
  /** Refresh interval for -watch, in seconds. */
  intervalSeconds?: number;
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
  getRemoteBranches: () => Promise<Set<string>>;
  fetchAndPrune: () => Promise<void>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  getWorktreeStatuses: (
    worktrees: WorktreeInfo[],
    mainBranch: string,
    trackedBranches?: Set<string>,
    remoteBranches?: Set<string>,
  ) => Promise<WorktreeStatus[]>;
  getLastCommit: (worktreePath: string) => Promise<CommitInfo | null>;
  getAheadBehind: (branch: string, baseBranch: string) => Promise<AheadBehind | null>;
  startSpinner: (message: string) => Spinner;
  readAllSessions: () => Promise<Record<string, SessionInfo>>;
  listWeztermPanes: () => Promise<WeztermPane[] | null>;
  listTmuxPanes: () => Promise<TmuxPane[] | null>;
  listHerdrPanes: () => Promise<HerdrPane[] | null>;
  gcMissingSessions: () => Promise<number>;
  gcMissingSlots: () => Promise<number>;
};

/**
 * Terminal and timer seam for `list -watch`. Injecting it keeps the redraw loop
 * drivable from tests without a real TTY or wall-clock timers.
 */
export type ListWatchIo = {
  write: (chunk: string) => void;
  rows: () => number;
  columns: () => number;
  now: () => Date;
  setRawMode: (enabled: boolean) => void;
  /** Subscribes to key presses; returns an unsubscribe function. */
  onKey: (listener: (data: Buffer) => void) => () => void;
  /** Subscribes to terminal resizes (SIGWINCH); returns an unsubscribe function. */
  onResize: (listener: () => void) => () => void;
  /** Subscribes to process exit; returns an unsubscribe function. */
  onExit: (listener: () => void) => () => void;
  /** Starts a repeating timer; returns a cancel function. */
  setInterval: (callback: () => void, ms: number) => () => void;
  exit: (code: number) => void;
};
