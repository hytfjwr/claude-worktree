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
  pane_id: number;
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
  | { type: "help" }
  | { type: "create"; args: CreateArgs }
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
  listWorktrees: () => Promise<WorktreeInfo[]>;
  getWorktreeStatuses: (worktrees: WorktreeInfo[]) => Promise<WorktreeStatus[]>;
  getLastCommit: (worktreePath: string) => Promise<CommitInfo | null>;
  getAheadBehind: (branch: string, baseBranch: string) => Promise<AheadBehind | null>;
  getMainBranch: () => Promise<string>;
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
  listWorktrees: () => Promise<WorktreeInfo[]>;
  getWorktreeStatuses: (worktrees: WorktreeInfo[]) => Promise<WorktreeStatus[]>;
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
