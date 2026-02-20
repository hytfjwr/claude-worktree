import type { ResumeCommandOptions } from "./claude.ts";
import type { GitContext, ListWorktreesResult, WorktreeInfo } from "./git.ts";
import type { SessionInfo } from "./session.ts";
import type { TerminalBackend } from "./wezterm.ts";

export type ResumeDeps = {
  getGitContext: () => Promise<GitContext>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  saveSession: (worktreePath: string, session: SessionInfo) => Promise<void>;
  completeSession: (worktreePath: string) => Promise<void>;
  buildResumeCommand: (options: ResumeCommandOptions) => string;
  ensurePaneBackend: (usageHint: string) => Promise<TerminalBackend>;
  selectWorktree: (worktrees: WorktreeInfo[]) => Promise<WorktreeInfo | null>;
};
