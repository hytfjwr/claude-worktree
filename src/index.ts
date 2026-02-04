// Git utilities
export {
  getGitContext,
  getWorktreePath,
  buildWorktreeCommand,
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
} from "./git";
export type { GitContext, WorktreeInfo, WorktreeStatus } from "./git";

// WezTerm utilities
export { splitPaneRight, setTabTitle, sendText, sendCommand, createPane } from "./wezterm";
export type { PaneOptions } from "./wezterm";

// Claude utilities
export { buildClaudeCommand } from "./claude";
export type { ClaudeOptions } from "./claude";

// Clean command
export { executeClean } from "./clean";
export type { CleanArgs as CleanCommandArgs, CleanResult } from "./clean";

// Prompt utilities
export { confirm, selectMultiple } from "./prompt";

// CLI
export { parseArgs, run, showHelp, runCreate } from "./cli";
export type { CliArgs, CreateArgs, CleanArgs, Command } from "./cli";
