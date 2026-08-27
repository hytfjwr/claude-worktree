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
  /**
   * Whether to delete the session entry during rollback. Set it only when the
   * rolling-back process owns that entry: the pane-side child (which is the
   * session), or the parent once its `saveSession` has succeeded. A worktree path
   * can be reused, so deleting an entry this process did not write could drop
   * another process's live session.
   */
  deleteSessionData: boolean;
};
