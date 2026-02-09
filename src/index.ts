// Types (centralized)
export type {
  // Git
  GitContext,
  WorktreeInfo,
  WorktreeStatus,
  ParsedWorktree,
  CommitInfo,
  AheadBehind,
  // Claude
  MergeInstructions,
  DraftInstructions,
  ClaudeOptions,
  // WezTerm
  PaneOptions,
  // Config
  ProjectConfig,
  HookVars,
  // Options
  BooleanOptionDef,
  StringOptionDef,
  OptionDef,
  OptionSchema,
  ExtractResult,
  // Spinner
  Spinner,
  // CLI
  CreateArgs,
  CliArgs,
  Command,
  // List
  ListArgs,
  WorktreeListEntry,
  ListResult,
  ListDeps,
  // Clean
  CleanArgs,
  CleanArgs as CleanCommandArgs,
  CleanResult,
  CleanDeps,
} from "./types";

// Git utilities
export {
  getGitContext,
  getWorktreePath,
  buildWorktreeCommand,
  createWorktree,
  getMainBranch,
  listWorktrees,
  isWorktreeDirty,
  isBranchMerged,
  isRemoteBranchDeleted,
  removeWorktree,
  fetchAndPrune,
  getWorktreeStatuses,
  findWorktreeByBranch,
  deleteLocalBranch,
  getLastCommit,
  getAheadBehind,
} from "./git";

// WezTerm utilities
export { splitPaneRight, sendText, sendCommand, createPane, checkWeztermAvailable } from "./wezterm";

// Claude utilities
export { buildClaudeCommand } from "./claude";

// Config utilities
export { loadProjectConfig, buildHookCommand, runHook } from "./config";

// Slot utilities
export { isPortInUse, findAvailableSlot } from "./slot";

// Clean command
export { executeClean } from "./clean";

// List command
export { executeList } from "./list";

// Spinner utilities
export { startSpinner } from "./spinner";

// Prompt utilities
export { confirm, selectMultiple } from "./prompt";

// Options extraction
export { extractOptions } from "./options";

// CLI
export { parseArgs, run, showHelp, runCreate, parseListArgs } from "./cli";
