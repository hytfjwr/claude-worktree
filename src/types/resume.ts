import type { ResumeCommandOptions } from "./claude.ts";
import type { ProjectConfig } from "./config.ts";
import type { GitContext, ListWorktreesResult, WorktreeInfo } from "./git.ts";
import type { AllPanes, SessionInfo, SessionState } from "./session.ts";
import type { HerdrPane, TerminalBackend, TmuxPane, WeztermPane } from "./wezterm.ts";

export type ResumeDeps = {
  getGitContext: () => Promise<GitContext>;
  loadProjectConfig: (repoRoot: string) => Promise<ProjectConfig | null>;
  listWorktrees: () => Promise<ListWorktreesResult>;
  saveSession: (worktreePath: string, session: SessionInfo) => Promise<void>;
  completeSession: (worktreePath: string) => Promise<void>;
  readSession: (worktreePath: string) => Promise<SessionInfo | undefined>;
  determineSessionStatus: (session: SessionInfo, allPanes: AllPanes) => SessionState;
  listWeztermPanes: () => Promise<WeztermPane[] | null>;
  listTmuxPanes: () => Promise<TmuxPane[] | null>;
  listHerdrPanes: () => Promise<HerdrPane[] | null>;
  confirm: (message: string) => Promise<boolean>;
  buildResumeCommand: (options: ResumeCommandOptions) => string;
  ensurePaneBackend: (usageHint: string) => Promise<TerminalBackend>;
  selectWorktree: (worktrees: WorktreeInfo[]) => Promise<WorktreeInfo | null>;
};
