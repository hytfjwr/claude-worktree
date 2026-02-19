import type { ClaudeOptions } from "./claude.ts";
import type { HookExecOptions, HookExecResult, HookVars, ProjectConfig } from "./config.ts";
import type { GitContext, ListWorktreesResult } from "./git.ts";
import type { RollbackOptions } from "./rollback.ts";
import type { SessionInfo } from "./session.ts";
import type { Spinner } from "./spinner.ts";
import type { PaneOptions } from "./wezterm.ts";

export type CreateDeps = {
  // Git operations
  checkWeztermAvailable: () => Promise<boolean>;
  isRunningInsideWezterm: () => boolean;
  getGitContext: () => Promise<GitContext>;
  getWorktreePath: (repoRoot: string, repoName: string, branchName: string) => string;
  loadProjectConfig: (repoRoot: string) => Promise<ProjectConfig | null>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  branchExists: (branchName: string) => Promise<boolean>;
  verifyBranchRef: (ref: string) => Promise<boolean>;
  fetchOrigin: (branch?: string) => Promise<void>;
  createWorktree: (branchName: string, worktreePath: string, baseBranch: string) => Promise<void>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  deleteLocalBranch: (branchName: string, force?: boolean) => Promise<void>;

  // Config/hooks
  buildHookCommand: (template: string, vars: HookVars) => string;
  resolveHookTimeout: (hookName: "postCreate" | "preClean" | "postClean", config: ProjectConfig | null) => number;
  executeHookWithSpinner: (options: HookExecOptions) => Promise<HookExecResult>;

  // Session/slot
  assignSlot: (worktreePath: string) => Promise<number>;
  readSlot: (worktreePath: string) => Promise<number | undefined>;
  deleteSlot: (worktreePath: string) => Promise<void>;
  saveSession: (worktreePath: string, session: SessionInfo) => Promise<void>;
  completeSession: (worktreePath: string) => Promise<void>;
  deleteSession: (worktreePath: string) => Promise<void>;

  // Claude/WezTerm
  buildClaudeCommand: (options: ClaudeOptions) => string;
  createPane: (options?: PaneOptions) => Promise<string>;
  sendCommand: (paneId: string, command: string) => Promise<void>;

  // UI
  confirm: (message: string) => Promise<boolean>;
  startSpinner: (message: string) => Spinner;

  // Rollback
  performRollback: (options: RollbackOptions) => Promise<void>;
};
