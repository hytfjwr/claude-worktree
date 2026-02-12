// Types (centralized)

// CLI
export {
  parseArgs,
  parseListArgs,
  parseResumeArgs,
  run,
  showCleanHelp,
  showCreateHelp,
  showHelp,
  showListHelp,
  showResumeHelp,
  validateBranchName,
} from "./cli.ts";
// Clean command
export { executeClean } from "./commands/clean.ts";
// Create command
export { buildClaudeOptions, readPlanFile, runCreate } from "./commands/create.ts";
// Hook utilities (shared between create and run-in-pane)
export { executeHookWithSpinner } from "./commands/hooks.ts";
// List command
export { executeList, formatSessionState } from "./commands/list.ts";
// Resume command
export { runResume } from "./commands/resume.ts";
// Rollback utility
export { performRollback } from "./commands/rollback.ts";
// Run-in-pane command
export { executeRunInPane } from "./commands/run-in-pane.ts";
// Cache utilities
export { LOCK_MAX_RETRIES, LOCK_RETRY_INTERVAL_MS } from "./core/cache.ts";
// Config utilities
export { buildHookCommand, loadProjectConfig, runHook } from "./core/config.ts";
// Error utilities
export { getErrorMessage, isNodeError } from "./core/errors.ts";
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
  verifyBranchRef,
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
export { buildClaudeCommand, buildResumeCommand } from "./external/claude.ts";
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
  ListWorktreesResult,
  // Claude
  MergeInstructions,
  OptionDef,
  OptionSchema,
  // WezTerm
  PaneOptions,
  ParsedWorktree,
  // Config
  ProjectConfig,
  // Resume
  ResumeArgs,
  ResumeCommandOptions,
  ResumeDeps,
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
// Color utilities
export { isColorEnabled, shouldUseColor } from "./ui/color.ts";
// Icon utilities
export { icons } from "./ui/icons.ts";
export type { Logger } from "./ui/logger.ts";
// Logger utilities
export { createSilentLogger, logDebug, logError, logInfo, logWarn, resetLogger, setLogger } from "./ui/logger.ts";
// Prompt utilities
export { confirm, selectMultiple, selectWorktree } from "./ui/prompt.ts";
export type { SelectItem } from "./ui/select.ts";
// Select utilities
export { selectMany, selectSingle } from "./ui/select.ts";
// Spinner utilities
export { startSpinner } from "./ui/spinner.ts";
// Version
export { getVersion } from "./version.ts";
