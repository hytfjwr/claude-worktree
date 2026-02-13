import type { HookVars, ProjectConfig } from "./config.ts";
import type { GitContext, ListWorktreesResult, WorktreeInfo, WorktreeStatus } from "./git.ts";
import type { Spinner } from "./spinner.ts";

export type CleanArgs = {
  force: boolean;
  all: boolean;
  dryRun: boolean;
  verbose: boolean;
};

export type CleanResult = {
  deleted: string[];
  skipped: string[];
  errors: Array<{ path: string; error: string }>;
};

export type CleanDeps = {
  fetchAndPrune: () => Promise<void>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  getWorktreeStatuses: (worktrees: WorktreeInfo[], mainBranch: string) => Promise<WorktreeStatus[]>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  deleteLocalBranch: (branchName: string, force?: boolean) => Promise<void>;
  getGitContext: () => Promise<GitContext>;
  loadProjectConfig: (repoRoot: string) => Promise<ProjectConfig | null>;
  buildHookCommand: (template: string, vars: HookVars) => string;
  runHook: (
    command: string,
    cwd: string,
    options?: { verbose?: boolean; onLine?: (line: string) => void; timeout?: number },
  ) => Promise<void>;
  readSlot: (worktreePath: string) => Promise<number | undefined>;
  deleteSlot: (worktreePath: string) => Promise<void>;
  deleteSession: (worktreePath: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  selectMultiple: (statuses: WorktreeStatus[]) => Promise<WorktreeStatus[]>;
  startSpinner: (message: string) => Spinner;
};
