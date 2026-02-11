import { runHook } from "../core/config.ts";
import { getErrorMessage } from "../core/errors.ts";
import { removeWorktree } from "../core/git.ts";
import { deleteSession } from "../core/session.ts";
import { deleteSlot } from "../core/slot.ts";
import type { RollbackOptions } from "../types.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";

type StepResult = { name: string; success: boolean; error?: string };

export async function performRollback(options: RollbackOptions): Promise<void> {
  const { worktreePath, repoRoot, verbose } = options;
  const steps: StepResult[] = [];

  console.log("Rolling back...");

  // Step 1: preClean hook
  if (options.preCleanCommand) {
    try {
      await runHook(options.preCleanCommand, repoRoot, {
        verbose,
        timeout: options.preCleanTimeout,
      });
      steps.push({ name: "preClean", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) console.warn(`  preClean failed: ${message}`);
      steps.push({ name: "preClean", success: false, error: message });
    }
  }

  // Step 2: Remove worktree
  try {
    await removeWorktree(worktreePath);
    steps.push({ name: "worktree removal", success: true });
  } catch (err) {
    const message = getErrorMessage(err);
    if (verbose) console.warn(`  worktree removal failed: ${message}`);
    steps.push({ name: "worktree removal", success: false, error: message });
  }

  // Step 3: postClean hook
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
      if (verbose) console.warn(`  postClean failed: ${message}`);
      steps.push({ name: "postClean", success: false, error: message });
    }
  }

  // Step 4: Slot cleanup
  if (options.slot != null) {
    try {
      await deleteSlot(worktreePath);
      steps.push({ name: "slot cleanup", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) console.warn(`  slot cleanup failed: ${message}`);
      steps.push({ name: "slot cleanup", success: false, error: message });
    }
  }

  // Step 5: Session cleanup (only when deleteSessionData is true)
  if (options.deleteSessionData) {
    try {
      await deleteSession(worktreePath);
      steps.push({ name: "session cleanup", success: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) console.warn(`  session cleanup failed: ${message}`);
      steps.push({ name: "session cleanup", success: false, error: message });
    }
  }

  // Print summary only when any step fails
  const hasFailure = steps.some((s) => !s.success);
  if (hasFailure) {
    console.log("\nRollback Summary:");
    for (const step of steps) {
      const marker = step.success ? "\u2713" : "\u2717";
      const detail = step.error ? ` (${step.error})` : "";
      console.log(`  ${marker} ${step.name}${detail}`);
    }
    console.warn("WARNING: Rollback incomplete. Manual cleanup may be required.");
  }
}
