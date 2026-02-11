// Types (centralized)

// CLI
export { parseArgs, parseListArgs, run, showHelp } from "./cli.ts";
// Clean command
export { executeClean } from "./commands/clean.ts";
// Create command
export { buildClaudeOptions, readPlanFile, runCreate } from "./commands/create.ts";
// Hook utilities (shared between create and run-in-pane)
export { executeHookWithSpinner } from "./commands/hooks.ts";
// List command
export { executeList, formatSessionState } from "./commands/list.ts";
// Rollback utility
export { performRollback } from "./commands/rollback.ts";
// Run-in-pane command
export { executeRunInPane } from "./commands/run-in-pane.ts";
// Config utilities
export { buildHookCommand, loadProjectConfig, runHook } from "./core/config.ts";
// Git utilities
export {
  buildWorktreeCommand,
  createWorktree,
  deleteLocalBranch,
  fetchAndPrune,
  findWorktreeByBranch,
  getAheadBehind,
  getGitContext,
  getLastCommit,
  getMainBranch,
  getWorktreePath,
  getWorktreeStatuses,
  isBranchMerged,
  isRemoteBranchDeleted,
  isWorktreeDirty,
  listWorktrees,
  removeWorktree,
} from "./core/git.ts";
// Session utilities
export {
  completeSession,
  deleteSession,
  determineSessionStatus,
  formatElapsed,
  readAllSessions,
  readSession,
  saveSession,
} from "./core/session.ts";
// Slot utilities
export { deleteSlot, findAvailableSlot, getCacheDir, isPortInUse, readSlot, saveSlot } from "./core/slot.ts";
// Claude utilities
export { buildClaudeCommand } from "./external/claude.ts";
// WezTerm utilities
export {
  checkWeztermAvailable,
  createPane,
  listWeztermPanes,
  sendCommand,
  sendText,
  splitPaneRight,
} from "./external/wezterm.ts";
// Options extraction
export { extractOptions } from "./options.ts";
export type {
  AheadBehind,
  // Options
  BooleanOptionDef,
  ClaudeOptions,
  // Clean
  CleanArgs,
  CleanArgs as CleanCommandArgs,
  CleanDeps,
  CleanResult,
  CliArgs,
  Command,
  CommitInfo,
  // Create
  CreateArgs,
  CreateDeps,
  DraftInstructions,
  ExtractResult,
  // Git
  GitContext,
  // Hook
  HookExecOptions,
  HookExecResult,
  HookVars,
  // List
  ListArgs,
  ListDeps,
  ListResult,
  // Claude
  MergeInstructions,
  OptionDef,
  OptionSchema,
  // WezTerm
  PaneOptions,
  ParsedWorktree,
  // Config
  ProjectConfig,
  // Rollback
  RollbackOptions,
  // RunInPane
  RunInPaneArgs,
  // Session
  SessionInfo,
  SessionMode,
  SessionState,
  // Spinner
  Spinner,
  StringOptionDef,
  WeztermPane,
  WorktreeInfo,
  WorktreeListEntry,
  WorktreeStatus,
} from "./types.ts";
// Prompt utilities
export { confirm, selectMultiple } from "./ui/prompt.ts";
// Spinner utilities
export { startSpinner } from "./ui/spinner.ts";
