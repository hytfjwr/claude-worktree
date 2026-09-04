import type { HookVars, ProjectConfig, RunHookFn } from "./config.ts";
import type { GitContext, ListWorktreesResult, WorktreeInfo, WorktreeStatus } from "./git.ts";
import type { PullRequestInfo } from "./github.ts";
import type { ConfirmOptions } from "./prompt.ts";
import type { AllPanes, SessionInfo, SessionState } from "./session.ts";
import type { Spinner } from "./spinner.ts";

export type CleanArgs = {
  force: boolean;
  discardUnsaved: boolean;
  all: boolean;
  dryRun: boolean;
  verbose: boolean;
  quiet: boolean;
  branches: string[];
};

export type CleanResult = {
  deleted: string[];
  skipped: string[];
  errors: Array<{ path: string; error: string }>;
  /** Worktrees whose directory was removed but whose local branch could not be deleted. */
  branchDeletionFailures: Array<{ path: string; branch: string; error: string }>;
};

export type CleanDeps = {
  getRemoteTrackingBranches: () => Promise<Set<string>>;
  getRemoteBranches: () => Promise<Set<string>>;
  fetchAndPrune: () => Promise<void>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  listWorktreePaths: () => Promise<string[]>;
  getWorktreeStatuses: (
    worktrees: WorktreeInfo[],
    mainBranch: string,
    trackedBranches?: Set<string>,
    remoteBranches?: Set<string>,
  ) => Promise<WorktreeStatus[]>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  removeWorktreeParentDirIfEmpty: (worktreePath: string) => Promise<boolean>;
  deleteLocalBranch: (branchName: string, force?: boolean) => Promise<void>;
  getGitContext: () => Promise<GitContext>;
  loadProjectConfig: (repoRoot: string) => Promise<ProjectConfig | null>;
  buildHookCommand: (template: string, vars: HookVars) => string;
  runHook: RunHookFn;
  readSlot: (worktreePath: string) => Promise<number | undefined>;
  deleteSlot: (worktreePath: string) => Promise<void>;
  deleteSession: (worktreePath: string) => Promise<void>;
  gcSessions: (validPaths: Set<string>) => Promise<number>;
  gcSlots: (validPaths: Set<string>) => Promise<number>;
  getUnpushedCommitCount: (worktreePath: string, branch: string) => Promise<number | null>;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  selectMultiple: (statuses: WorktreeStatus[]) => Promise<WorktreeStatus[]>;
  startSpinner: (message: string) => Spinner;
  checkGhAvailable: () => Promise<boolean>;
  getPullRequestsForBranches: (branches: string[]) => Promise<Map<string, PullRequestInfo>>;
  readAllSessions: () => Promise<Record<string, SessionInfo>>;
  listWeztermPanes: () => Promise<AllPanes["wezterm"]>;
  listTmuxPanes: () => Promise<AllPanes["tmux"]>;
  listHerdrPanes: () => Promise<AllPanes["herdr"]>;
  determineSessionStatus: (session: SessionInfo, allPanes: AllPanes, now?: Date) => SessionState;
};
