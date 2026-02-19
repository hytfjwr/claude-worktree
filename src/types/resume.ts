import type { ResumeCommandOptions } from "./claude.ts";
import type { GitContext, ListWorktreesResult, WorktreeInfo } from "./git.ts";
import type { SessionInfo } from "./session.ts";
import type { PaneOptions } from "./wezterm.ts";

export type ResumeDeps = {
  checkWeztermAvailable: () => Promise<boolean>;
  isRunningInsideWezterm: () => boolean;
  getGitContext: () => Promise<GitContext>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  saveSession: (worktreePath: string, session: SessionInfo) => Promise<void>;
  completeSession: (worktreePath: string) => Promise<void>;
  buildResumeCommand: (options: ResumeCommandOptions) => string;
  createPane: (options?: PaneOptions) => Promise<string>;
  sendCommand: (paneId: string, command: string) => Promise<void>;
  selectWorktree: (worktrees: WorktreeInfo[]) => Promise<WorktreeInfo | null>;
};
