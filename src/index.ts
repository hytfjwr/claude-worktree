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
export type { GitContext, WorktreeInfo, WorktreeStatus, CommitInfo, AheadBehind } from "./git";

// WezTerm utilities
export { splitPaneRight, sendText, sendCommand, createPane, checkWeztermAvailable } from "./wezterm";
export type { PaneOptions } from "./wezterm";

// Claude utilities
export { buildClaudeCommand } from "./claude";
export type { ClaudeOptions } from "./claude";

// Config utilities
export { loadProjectConfig, buildHookCommand, runHook } from "./config";
export type { ProjectConfig, HookVars } from "./config";

// Slot utilities
export { isPortInUse, findAvailableSlot } from "./slot";

// Clean command
export { executeClean } from "./clean";
export type { CleanArgs as CleanCommandArgs, CleanResult } from "./clean";

// List command
export { executeList } from "./list";
export type { ListArgs, ListResult, WorktreeListEntry, ListDeps } from "./list";

// Spinner utilities
export { startSpinner } from "./spinner";
export type { Spinner } from "./spinner";

// Prompt utilities
export { confirm, selectMultiple } from "./prompt";

// Options extraction
export { extractOptions } from "./options";
export type {
  BooleanOptionDef,
  StringOptionDef,
  OptionDef,
  OptionSchema,
  ExtractResult,
} from "./options";

// CLI
export { parseArgs, run, showHelp, runCreate, parseListArgs } from "./cli";
export type { CliArgs, CreateArgs, CleanArgs, Command } from "./cli";
