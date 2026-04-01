import { runHook } from "../core/config.ts";
import { getErrorMessage } from "../core/errors.ts";
import { deleteLocalBranch, removeWorktree } from "../core/git.ts";
import { deleteSession } from "../core/session.ts";
import { deleteSlot } from "../core/slot.ts";
import type { RollbackOptions } from "../types/index.ts";
import { icons } from "../ui/icons.ts";
import { logInfo, logWarn } from "../ui/logger.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";

type StepResult = { name: string; success: boolean; error?: string };

export async function performRollback(options: RollbackOptions): Promise<void> {
  const { worktreePath, repoRoot, verbose } = options;
  const steps: StepResult[] = [];

  logInfo("Rolling back...");

  // preClean hook
  if (options.preCleanCommand) {
    try {
      await runHook(options.preCleanCommand, repoRoot, {
        verbose,
        timeout: options.preCleanTimeout,
      });
      steps.push({ name: "preClean", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) logWarn(`  preClean failed: ${message}`);
      steps.push({ name: "preClean", success: false, error: message });
    }
  }

  // Remove worktree
  try {
    await removeWorktree(worktreePath);
    steps.push({ name: "worktree removal", success: true });
  } catch (err) {
    const message = getErrorMessage(err);
    if (verbose) logWarn(`  worktree removal failed: ${message}`);
    steps.push({ name: "worktree removal", success: false, error: message });
  }

  // Delete local branch (created by `git worktree add -b`)
  if (options.branchName) {
    try {
      await deleteLocalBranch(options.branchName, true);
      steps.push({ name: "branch deletion", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) logWarn(`  branch deletion failed: ${message}`);
      steps.push({ name: "branch deletion", success: false, error: message });
    }
  }

  // postClean hook
  if (options.postCleanCommand) {
    const spinner = verbose
      ? null
      : startSpinner("Running postClean hook (rollback)...", { timeoutSec: options.postCleanTimeout });
    try {
      await runHook(options.postCleanCommand, repoRoot, {
        verbose,
        onLine: spinner ? createTailUpdater(spinner) : undefined,
        timeout: options.postCleanTimeout,
      });
      spinner?.stop();
      steps.push({ name: "postClean", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      spinner?.fail("postClean hook failed during rollback");
      if (verbose) logWarn(`  postClean failed: ${message}`);
      steps.push({ name: "postClean", success: false, error: message });
    }
  }

  // Slot cleanup
  if (options.slot != null) {
    try {
      await deleteSlot(worktreePath);
      steps.push({ name: "slot cleanup", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) logWarn(`  slot cleanup failed: ${message}`);
      steps.push({ name: "slot cleanup", success: false, error: message });
    }
  }

  // Session cleanup (only when deleteSessionData is true)
  if (options.deleteSessionData) {
    try {
      await deleteSession(worktreePath);
      steps.push({ name: "session cleanup", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) logWarn(`  session cleanup failed: ${message}`);
      steps.push({ name: "session cleanup", success: false, error: message });
    }
  }

  // Print summary only when any step fails
  const hasFailure = steps.some((s) => !s.success);
  if (hasFailure) {
    logInfo("\nRollback Summary:");
    for (const step of steps) {
      const marker = step.success ? icons.success() : icons.fail();
      const detail = step.error ? ` (${step.error})` : "";
      logInfo(`  ${marker} ${step.name}${detail}`);
    }
    logWarn("WARNING: Rollback incomplete. Manual cleanup may be required.");
  }
}
