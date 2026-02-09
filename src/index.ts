// Types (centralized)

// Claude utilities
export { buildClaudeCommand } from "./claude";
// Clean command
export { executeClean } from "./clean";
// CLI
export { parseArgs, parseListArgs, run, runCreate, showHelp } from "./cli";
// Config utilities
export { buildHookCommand, loadProjectConfig, runHook } from "./config";
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
} from "./git";
// List command
export { executeList } from "./list";
// Options extraction
export { extractOptions } from "./options";
// Prompt utilities
export { confirm, selectMultiple } from "./prompt";
// Slot utilities
export { findAvailableSlot, isPortInUse } from "./slot";
// Spinner utilities
export { startSpinner } from "./spinner";
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
  // CLI
  CreateArgs,
  DraftInstructions,
  ExtractResult,
  // Git
  GitContext,
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
  // Spinner
  Spinner,
  StringOptionDef,
  WorktreeInfo,
  WorktreeListEntry,
  WorktreeStatus,
} from "./types";
// WezTerm utilities
export { checkWeztermAvailable, createPane, sendCommand, sendText, splitPaneRight } from "./wezterm";
