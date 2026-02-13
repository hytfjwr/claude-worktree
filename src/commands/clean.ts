import { buildHookCommand, loadProjectConfig, resolveHookTimeout, runHook } from "../core/config.ts";
import { getErrorMessage } from "../core/errors.ts";
import {
  deleteLocalBranch,
  fetchAndPrune,
  getGitContext,
  getWorktreeStatuses,
  listWorktrees,
  removeWorktree,
} from "../core/git.ts";
import { deleteSession } from "../core/session.ts";
import { deleteSlot, readSlot } from "../core/slot.ts";
import type { CleanArgs, CleanDeps, CleanResult, ProjectConfig, WorktreeStatus } from "../types/index.ts";
import { icons } from "../ui/icons.ts";
import { logDebug, logInfo, logWarn } from "../ui/logger.ts";
import { confirm, selectMultiple } from "../ui/prompt.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";

const defaultDeps: CleanDeps = {
  fetchAndPrune,
  listWorktrees,
  getWorktreeStatuses,
  removeWorktree,
  deleteLocalBranch,
  getGitContext,
  loadProjectConfig,
  buildHookCommand,
  runHook,
  readSlot,
  deleteSlot,
  deleteSession,
  confirm,
  selectMultiple,
  startSpinner,
};

export async function executeClean(args: CleanArgs, deps: CleanDeps = defaultDeps): Promise<CleanResult> {
  const result: CleanResult = {
    deleted: [],
    skipped: [],
    errors: [],
  };

  if (!args.dryRun) {
    const fetchSpinner = deps.startSpinner("Updating remote references...");
    try {
      await deps.fetchAndPrune();
      fetchSpinner.stop(`${icons.success()} Done updating remote references.`);
    } catch {
      fetchSpinner.fail("Failed to update remote references (continuing)");
    }
  }

  const listSpinner = deps.startSpinner("Fetching worktree list...");
  let worktrees: Awaited<ReturnType<CleanDeps["listWorktrees"]>>["worktrees"];
  let statuses: Awaited<ReturnType<CleanDeps["getWorktreeStatuses"]>>;
  try {
    const listResult = await deps.listWorktrees();
    worktrees = listResult.worktrees;

    if (worktrees.length === 0) {
      listSpinner.stop("No worktrees found.");
      return result;
    }

    statuses = await deps.getWorktreeStatuses(worktrees, listResult.mainBranch);
    listSpinner.stop(`${icons.success()} Done fetching worktree list.`);
  } catch (error) {
    listSpinner.fail("Failed to fetch worktree list");
    throw error;
  }

  // Filter out main worktrees for display
  const cleanableStatuses = statuses.filter((s) => !s.worktree.isMain);

  if (cleanableStatuses.length === 0) {
    logInfo("No cleanable worktrees found.");
    return result;
  }

  let toDelete: WorktreeStatus[];

  if (args.all) {
    // Manual selection mode
    toDelete = await deps.selectMultiple(cleanableStatuses);
  } else {
    // Auto-detect mode: show only auto-cleanable ones
    const autoCleanable = cleanableStatuses.filter((s) => s.canAutoClean);

    if (autoCleanable.length === 0) {
      logInfo(`\n${icons.sparkle()} No unnecessary worktrees detected.`);
      logInfo("Hint: use -all option to show all worktrees.");
      return result;
    }

    logInfo(`\n${icons.trash()}  Deletion candidates:`);
    for (const status of autoCleanable) {
      const branch = status.worktree.branch || "(detached)";
      logInfo(`  ${icons.bullet()} ${branch}`);
      logInfo(`    Path: ${status.worktree.path}`);
      logInfo(`    Reason: ${status.reason}`);
    }

    toDelete = autoCleanable;
  }

  if (toDelete.length === 0) {
    logInfo("\nNo targets to delete.");
    return result;
  }

  // Dry run mode
  if (args.dryRun) {
    logInfo("\n[dry-run] The following worktrees would be deleted:");
    for (const status of toDelete) {
      logInfo(`  ${icons.bullet()} ${status.worktree.branch || status.worktree.path}`);
    }
    return result;
  }

  // Confirmation
  if (!args.force) {
    logInfo("");
    const confirmed = await deps.confirm(`Delete ${toDelete.length} worktree(s)?`);
    if (!confirmed) {
      logInfo("Cancelled.");
      return result;
    }
  }

  // Load config for preClean hook
  let repoRoot: string | undefined;
  let config: ProjectConfig | null = null;
  try {
    const git = await deps.getGitContext();
    repoRoot = git.repoRoot;
    config = await deps.loadProjectConfig(repoRoot);
  } catch (error) {
    const message = getErrorMessage(error);
    logDebug(`preClean hooks will be skipped: failed to get git context or load project config: ${message}`);
  }

  // Execute deletion
  logInfo("");
  for (const status of toDelete) {
    const { worktree } = status;
    const label = worktree.branch || worktree.path;
    const spinner = deps.startSpinner(`Deleting ${label}...`);
    try {
      // Read cached slot for this worktree
      const slot = await deps.readSlot(worktree.path);

      // preClean hook
      if (config?.preClean && repoRoot) {
        const hookCmd = deps.buildHookCommand(config.preClean, { path: worktree.path, slot });
        try {
          await deps.runHook(hookCmd, repoRoot, {
            verbose: args.verbose,
            onLine: args.verbose ? undefined : createTailUpdater(spinner),
            timeout: resolveHookTimeout("preClean", config),
          });
        } catch (error) {
          const message = getErrorMessage(error);
          logWarn(`  preClean hook failed (continuing): ${message}`);
        }
      }

      await deps.removeWorktree(worktree.path, worktree.isDirty);

      // Delete local branch (skip for detached HEAD)
      if (worktree.branch) {
        try {
          await deps.deleteLocalBranch(worktree.branch, true);
        } catch (error) {
          const branchError = getErrorMessage(error);
          logWarn(`  Failed to delete branch ${worktree.branch}: ${branchError}`);
        }
      }

      // postClean hook
      if (config?.postClean && repoRoot) {
        const hookCmd = deps.buildHookCommand(config.postClean, { path: worktree.path, slot });
        try {
          await deps.runHook(hookCmd, repoRoot, {
            verbose: args.verbose,
            onLine: args.verbose ? undefined : createTailUpdater(spinner),
            timeout: resolveHookTimeout("postClean", config),
          });
        } catch (error) {
          const message = getErrorMessage(error);
          logWarn(`  postClean hook failed (continuing): ${message}`);
        }
      }

      // Delete cached slot and session
      await deps.deleteSlot(worktree.path);
      await deps.deleteSession(worktree.path);

      spinner.stop(`${icons.success()} ${label}`);
      result.deleted.push(worktree.path);
    } catch (error) {
      const message = getErrorMessage(error);
      spinner.fail(`${label}: ${message}`);
      result.errors.push({ path: worktree.path, error: message });
    }
  }

  // Summary
  logInfo("");
  if (result.deleted.length > 0) {
    logInfo(`${icons.done()} Deleted ${result.deleted.length} worktree(s).`);
  }
  if (result.errors.length > 0) {
    logInfo(`${icons.warning()}  Failed to delete ${result.errors.length} worktree(s).`);
  }

  return result;
}
