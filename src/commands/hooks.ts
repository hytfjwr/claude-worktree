import { runHook as defaultRunHook } from "../core/config.ts";
import { getErrorMessage } from "../core/errors.ts";
import type { HookExecOptions, HookExecResult, HookRunOptions } from "../types/index.ts";
import { icons } from "../ui/icons.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";

/**
 * Run a hook command, streaming its output into the caller's spinner tail
 * (skipped when verbose, where output goes straight to stdout) and turning a
 * thrown error into a result value.
 * The spinner lifecycle (start/stop/fail) stays with the caller.
 */
export async function runHookWithTail(options: HookRunOptions): Promise<HookExecResult> {
  const { hookCmd, cwd, verbose, timeout, spinner, runHook = defaultRunHook } = options;
  try {
    await runHook(hookCmd, cwd, {
      verbose,
      onLine: !verbose && spinner ? createTailUpdater(spinner) : undefined,
      timeout,
    });
    return { success: true };
  } catch (error) {
    return { success: false, message: getErrorMessage(error) };
  }
}

/**
 * Execute a hook command with a dedicated spinner.
 * Returns a result indicating success or failure with message.
 * Callers decide how to handle failures (warn and continue, or error and rollback).
 */
export async function executeHookWithSpinner(options: HookExecOptions): Promise<HookExecResult> {
  const { hookCmd, cwd, label, verbose, timeout } = options;
  const spinner = verbose ? null : startSpinner(`Running ${label} hook...`, { timeoutSec: timeout });
  const result = await runHookWithTail({ hookCmd, cwd, verbose, timeout, spinner });
  if (result.success) {
    spinner?.stop(`${icons.success()} ${label} hook done`);
  } else {
    spinner?.fail(`${label} hook failed`);
  }
  return result;
}
