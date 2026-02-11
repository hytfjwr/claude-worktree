import { runHook } from "../core/config.ts";
import { getErrorMessage } from "../core/errors.ts";
import type { HookExecOptions, HookExecResult } from "../types.ts";
import { icons } from "../ui/icons.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";

/**
 * Execute a hook command with spinner feedback.
 * Returns a result indicating success or failure with message.
 * Callers decide how to handle failures (warn and continue, or error and rollback).
 */
export async function executeHookWithSpinner(options: HookExecOptions): Promise<HookExecResult> {
  const { hookCmd, cwd, label, verbose, timeout } = options;
  const spinner = verbose ? null : startSpinner(`Running ${label} hook...`, { timeoutSec: timeout });
  try {
    await runHook(hookCmd, cwd, {
      verbose,
      onLine: spinner ? createTailUpdater(spinner) : undefined,
      timeout,
    });
    spinner?.stop(`${icons.success()} ${label} hook done`);
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error);
    spinner?.fail(`${label} hook failed`);
    return { success: false, message };
  }
}
