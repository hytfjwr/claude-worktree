export type RollbackOptions = {
  worktreePath: string;
  repoRoot: string;
  preCleanCommand?: string;
  preCleanTimeout: number;
  postCleanCommand?: string;
  postCleanTimeout: number;
  slot?: number;
  verbose: boolean;
  /** Whether to delete session data during rollback (true for pane mode, false for terminal mode pre-session) */
  deleteSessionData: boolean;
};
