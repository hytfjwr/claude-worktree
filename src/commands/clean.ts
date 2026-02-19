import { promiseAllLimit } from "../core/concurrency.ts";
import { buildHookCommand, loadProjectConfig, resolveHookTimeout, runHook } from "../core/config.ts";
import { getErrorMessage } from "../core/errors.ts";
import {
  deleteLocalBranch,
  fetchAndPrune,
  getGitContext,
  getRemoteBranches,
  getRemoteTrackingBranches,
  getWorktreeStatuses,
  listWorktrees,
  removeWorktree,
} from "../core/git.ts";
import { deleteSession, gcSessions } from "../core/session.ts";
import { deleteSlot, gcSlots, readSlot } from "../core/slot.ts";
import { checkGhAvailable, getPullRequestForBranch } from "../external/github.ts";
import type {
  CleanArgs,
  CleanDeps,
  CleanResult,
  ProjectConfig,
  PullRequestInfo,
  WorktreeStatus,
} from "../types/index.ts";
import { cyan, dim } from "../ui/color.ts";
import { icons } from "../ui/icons.ts";
import { logDebug, logInfo, logWarn } from "../ui/logger.ts";
import { confirm, selectMultiple } from "../ui/prompt.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";

const defaultDeps: CleanDeps = {
  getRemoteTrackingBranches,
  getRemoteBranches,
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
  gcSessions,
  gcSlots,
  confirm,
  selectMultiple,
  startSpinner,
  checkGhAvailable,
  getPullRequestForBranch,
};

export async function executeClean(args: CleanArgs, deps: CleanDeps = defaultDeps): Promise<CleanResult> {
  const result: CleanResult = {
    deleted: [],
    skipped: [],
    errors: [],
  };

  // Capture remote tracking branches BEFORE fetching/pruning
  // so we can distinguish "never pushed" from "remote deleted"
  let trackedBranches: Set<string> | undefined;
  let remoteBranches: Set<string> | undefined;
  try {
    [trackedBranches, remoteBranches] = await Promise.all([deps.getRemoteTrackingBranches(), deps.getRemoteBranches()]);
  } catch {
    // Continue without tracking info
  }

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

    statuses = await deps.getWorktreeStatuses(worktrees, listResult.mainBranch, trackedBranches, remoteBranches);
    listSpinner.stop(`${icons.success()} Done fetching worktree list.`);
  } catch (error) {
    listSpinner.fail("Failed to fetch worktree list");
    throw error;
  }

  // Filter out main worktrees for display
  const cleanableStatuses = statuses.filter((s) => !s.worktree.isMain);

  if (cleanableStatuses.length === 0 && args.branches.length === 0) {
    logInfo("No cleanable worktrees found.");
    return result;
  }

  // Fetch PR info for all cleanable branches
  const prMap = new Map<string, PullRequestInfo>();
  const ghAvailable = await deps.checkGhAvailable();
  if (ghAvailable) {
    const branches = cleanableStatuses.map((s) => s.worktree.branch).filter((b): b is string => b !== null);
    if (branches.length > 0) {
      const prSpinner = deps.startSpinner("Fetching PR information...");
      try {
        const results = await promiseAllLimit(branches.map((b) => () => deps.getPullRequestForBranch(b)));
        for (let i = 0; i < branches.length; i++) {
          const pr = results[i];
          if (pr) prMap.set(branches[i], pr);
        }
        prSpinner.stop(`${icons.success()} Done fetching PR information.`);
      } catch {
        prSpinner.fail("Failed to fetch PR information (continuing)");
      }
    }
  }

  let toDelete: WorktreeStatus[];

  if (args.branches.length > 0) {
    // Specific branch mode: find worktrees matching the given branch names
    const matched: WorktreeStatus[] = [];

    for (const branchName of args.branches) {
      const found = cleanableStatuses.find((s) => s.worktree.branch === branchName);
      if (found) {
        matched.push(found);
      } else {
        // Distinguish between "exists but is main" and "truly not found"
        const isMain = statuses.some((s) => s.worktree.branch === branchName && s.worktree.isMain);
        if (isMain) {
          logWarn(`Branch "${branchName}" is the main worktree and cannot be cleaned.`);
        } else {
          logWarn(`Worktree for branch "${branchName}" not found.`);
        }
      }
    }

    if (matched.length === 0) {
      logInfo("No matching worktrees to delete.");
      return result;
    }

    logInfo(`\n${icons.trash()}  Deletion targets:`);
    for (const status of matched) {
      const branch = status.worktree.branch || "(detached)";
      logInfo(`  ${icons.bullet()} ${cyan(branch)}`);
      logInfo(`    ${dim(`Path: ${status.worktree.path}`)}`);
      const pr = status.worktree.branch ? prMap.get(status.worktree.branch) : undefined;
      if (pr) {
        logInfo(`    ${dim(`PR: #${pr.number} ${pr.title} (${pr.state}) ${pr.url}`)}`);
      }
    }

    toDelete = matched;
  } else if (args.all) {
    // Manual selection mode: enrich reason with PR info for display
    const enrichedStatuses = cleanableStatuses.map((s) => {
      const pr = s.worktree.branch ? prMap.get(s.worktree.branch) : undefined;
      if (!pr) return s;
      return { ...s, reason: `${s.reason} | PR: #${pr.number} ${pr.title} (${pr.state})` };
    });
    toDelete = await deps.selectMultiple(enrichedStatuses);
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
      logInfo(`  ${icons.bullet()} ${cyan(branch)}`);
      logInfo(`    ${dim(`Path: ${status.worktree.path}`)}`);
      logInfo(`    ${dim(`Reason: ${status.reason}`)}`);
      const pr = status.worktree.branch ? prMap.get(status.worktree.branch) : undefined;
      if (pr) {
        logInfo(`    ${dim(`PR: #${pr.number} ${pr.title} (${pr.state}) ${pr.url}`)}`);
      }
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
      const label = status.worktree.branch || status.worktree.path;
      logInfo(`  ${icons.bullet()} ${cyan(label)}`);
      const pr = status.worktree.branch ? prMap.get(status.worktree.branch) : undefined;
      if (pr) {
        logInfo(`    ${dim(`PR: #${pr.number} ${pr.title} (${pr.state}) ${pr.url}`)}`);
      }
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

  // Garbage collect stale cache entries
  try {
    const freshList = await deps.listWorktrees();
    const validPaths = new Set(freshList.worktrees.map((w) => w.path));
    const [gcSessionCount, gcSlotCount] = await Promise.all([deps.gcSessions(validPaths), deps.gcSlots(validPaths)]);
    if (gcSessionCount > 0 || gcSlotCount > 0) {
      logDebug(`GC: removed ${gcSessionCount} stale session(s) and ${gcSlotCount} stale slot(s)`);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    logDebug(`GC failed (non-critical): ${message}`);
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
