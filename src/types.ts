// =============================================================================
// Git types
// =============================================================================

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

// =============================================================================
// Claude types
// =============================================================================

export type MergeInstructions = {
  baseBranch: string;
  worktreePath: string;
};

export type DraftInstructions = {
  baseBranch: string;
  branchName: string;
};

export type ClaudeOptions = {
  permissionMode?: "plan" | "auto-edit" | "full-auto";
  prompt: string;
  promptSuffix?: string;
  dangerouslySkipPermissions?: boolean;
  mergeInstructions?: MergeInstructions;
  draftInstructions?: DraftInstructions;
};

// =============================================================================
// WezTerm types
// =============================================================================

export type PaneOptions = {
  keepFocus?: boolean; // If true, restore focus to the original pane after split
};

export type WeztermPane = {
  paneId: number;
  title: string;
  cwd: string;
};

// =============================================================================
// Session types
// =============================================================================

export type SessionMode = "pane" | "terminal";

export type SessionInfo = {
  paneId?: number; // pane mode only
  mode: SessionMode;
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601, set when terminal mode completes
};

export type SessionState = {
  status: "running" | "done";
  elapsedMs: number;
  mode: SessionMode;
  paneId?: number;
};

// =============================================================================
// Config types
// =============================================================================

export type ProjectConfig = {
  maxWorktrees?: number; // Maximum number of concurrent worktrees (excludes main)
  hookTimeout?: number; // Timeout in seconds for all hooks (default: 600)
  postCreate?: string;
  postCreateTimeout?: number; // Timeout in seconds for the postCreate hook
  preClean?: string;
  preCleanTimeout?: number; // Timeout in seconds for the preClean hook
  postClean?: string;
  postCleanTimeout?: number; // Timeout in seconds for the postClean hook
};

export type HookVars = {
  path: string;
  slot?: number;
};

export type HookExecOptions = {
  hookCmd: string;
  cwd: string;
  label: string;
  verbose: boolean;
  timeout: number;
};

export type HookExecResult = { success: true } | { success: false; message: string };

// =============================================================================
// Options types
// =============================================================================

export type BooleanOptionDef = {
  type: "boolean";
  flag: string;
  alias?: string;
};

export type StringOptionDef = {
  type: "string";
  flag: string;
  alias?: string;
  errorMessage: string;
};

export type OptionDef = BooleanOptionDef | StringOptionDef;

export type OptionSchema = {
  options: Record<string, OptionDef>;
  unknownHandling: "passthrough" | "error";
  ignoredFlags?: string[];
  unknownErrorPrefix?: string;
};

export type ExtractResult = {
  booleans: Record<string, boolean>;
  strings: Record<string, string | undefined>;
  remaining: string[];
};

// =============================================================================
// Spinner types
// =============================================================================

export type Spinner = {
  stop: (finalMessage?: string) => void;
  fail: (message: string) => void;
  /**
   * @param lines - The most recent tail lines to display (up to TAIL_LINE_COUNT)
   * @param totalCount - Total number of lines seen since spinner start, used to compute hidden line count
   * @param allLines - All lines accumulated since spinner start, used for expanded view
   */
  updateTail: (lines: string[], totalCount: number, allLines?: string[]) => void;
  /** Returns true when the spinner is in expanded (Ctrl+O) mode */
  isExpanded: () => boolean;
};

// =============================================================================
// CLI types
// =============================================================================

export type CreateArgs = {
  branchName: string;
  prompt: string;
  planFile?: string;
  danger?: boolean;
  merge?: boolean;
  draft?: boolean;
  baseBranch?: string;
  pane?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
};

export type ResumeArgs = {
  branchName?: string;
  prompt?: string;
  danger?: boolean;
  pane?: boolean;
  verbose?: boolean;
};

export type ResumeCommandOptions = {
  prompt?: string;
  dangerouslySkipPermissions?: boolean;
};

export type RunInPaneArgs = {
  worktreePath: string;
  repoRoot: string;
  claudeCommand: string;
  postCreateCommand?: string;
  postCreateTimeout: number;
  preCleanCommand?: string;
  preCleanTimeout: number;
  postCleanCommand?: string;
  postCleanTimeout: number;
  slot?: number;
  verbose: boolean;
};

export type Command =
  | { type: "help"; commandHelp?: "create" | "list" | "clean" | "resume" }
  | { type: "version" }
  | { type: "create"; args: CreateArgs }
  | { type: "resume"; args: ResumeArgs }
  | { type: "clean"; args: CleanArgs }
  | { type: "list"; args: ListArgs }
  | { type: "_run-in-pane"; payloadPath: string };

// Re-export for backward compatibility
export type CliArgs = CreateArgs;

// =============================================================================
// List types
// =============================================================================

export type ListArgs = {
  json: boolean;
  verbose: boolean;
  status: boolean;
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
  fetchAndPrune: () => Promise<void>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  getWorktreeStatuses: (worktrees: WorktreeInfo[], mainBranch: string) => Promise<WorktreeStatus[]>;
  getLastCommit: (worktreePath: string) => Promise<CommitInfo | null>;
  getAheadBehind: (branch: string, baseBranch: string) => Promise<AheadBehind | null>;
  startSpinner: (message: string) => Spinner;
  readAllSessions: () => Promise<Record<string, SessionInfo>>;
  listWeztermPanes: () => Promise<WeztermPane[] | null>;
};

// =============================================================================
// Clean types
// =============================================================================

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

// =============================================================================
// Rollback types
// =============================================================================

export type RollbackOptions = {
  worktreePath: string;
  repoRoot: string;
  preCleanCommand?: string;
  preCleanTimeout: number;
  postCleanCommand?: string;
  postCleanTimeout: number;
  slot?: number;
  verbose: boolean;
  /** Whether to delete session data during rollback (true for pane mode, false for terminal mode pre-session) */
  deleteSessionData: boolean;
};

// =============================================================================
// Create types
// =============================================================================

export type CreateDeps = {
  // Git operations
  checkWeztermAvailable: () => Promise<boolean>;
  getGitContext: () => Promise<GitContext>;
  getWorktreePath: (repoRoot: string, repoName: string, branchName: string) => string;
  loadProjectConfig: (repoRoot: string) => Promise<ProjectConfig | null>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  branchExists: (branchName: string) => Promise<boolean>;
  verifyBranchRef: (ref: string) => Promise<boolean>;
  createWorktree: (branchName: string, worktreePath: string, baseBranch: string) => Promise<void>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  deleteLocalBranch: (branchName: string, force?: boolean) => Promise<void>;

  // Config/hooks
  buildHookCommand: (template: string, vars: HookVars) => string;
  resolveHookTimeout: (hookName: "postCreate" | "preClean" | "postClean", config: ProjectConfig | null) => number;
  executeHookWithSpinner: (options: HookExecOptions) => Promise<HookExecResult>;

  // Session/slot
  findAvailableSlot: () => Promise<number>;
  saveSlot: (worktreePath: string, slot: number) => Promise<void>;
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

  // Rollback
  performRollback: (options: RollbackOptions) => Promise<void>;
};

// =============================================================================
// Resume types
// =============================================================================

export type ResumeDeps = {
  checkWeztermAvailable: () => Promise<boolean>;
  getGitContext: () => Promise<GitContext>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  saveSession: (worktreePath: string, session: SessionInfo) => Promise<void>;
  completeSession: (worktreePath: string) => Promise<void>;
  buildResumeCommand: (options: ResumeCommandOptions) => string;
  createPane: (options?: PaneOptions) => Promise<string>;
  sendCommand: (paneId: string, command: string) => Promise<void>;
  selectWorktree: (worktrees: WorktreeInfo[]) => Promise<WorktreeInfo | null>;
};
