export type RollbackOptions = {
  worktreePath: string;
  repoRoot: string;
  /** Branch name to delete during rollback (created by `git worktree add -b`) */
  branchName?: string;
  preCleanCommand?: string;
  preCleanTimeout: number;
  postCleanCommand?: string;
  postCleanTimeout: number;
  slot?: number;
  verbose: boolean;
  /** Whether to delete session data during rollback (true for pane mode, false for terminal mode pre-session) */
  deleteSessionData: boolean;
};
