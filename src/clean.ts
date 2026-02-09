import {
  getGitContext,
  listWorktrees,
  getWorktreeStatuses,
  removeWorktree,
  deleteLocalBranch,
  fetchAndPrune,
  type WorktreeInfo,
  type WorktreeStatus,
  type GitContext,
} from "./git";
import { confirm, selectMultiple } from "./prompt";
import { loadProjectConfig, buildHookCommand, runHook, type ProjectConfig, type HookVars } from "./config";
import { startSpinner, createTailUpdater } from "./spinner";

export type CleanArgs = {
  force: boolean;
  all: boolean;
  dryRun: boolean;
  verbose: boolean;
};

export type CleanResult = {
  deleted: string[];
  skipped: string[];
  errors: Array<{ path: string; error: string }>;
};

export type CleanDeps = {
  fetchAndPrune: () => Promise<void>;
  listWorktrees: () => Promise<WorktreeInfo[]>;
  getWorktreeStatuses: (worktrees: WorktreeInfo[]) => Promise<WorktreeStatus[]>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  deleteLocalBranch: (branchName: string, force?: boolean) => Promise<void>;
  getGitContext: () => Promise<GitContext>;
  loadProjectConfig: (repoRoot: string) => Promise<ProjectConfig | null>;
  buildHookCommand: (template: string, vars: HookVars) => string;
  runHook: (command: string, cwd: string, options?: { verbose?: boolean; onLine?: (line: string) => void }) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  selectMultiple: (statuses: WorktreeStatus[]) => Promise<WorktreeStatus[]>;
};

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
  confirm,
  selectMultiple,
};

export async function executeClean(args: CleanArgs, deps: CleanDeps = defaultDeps): Promise<CleanResult> {
  const result: CleanResult = {
    deleted: [],
    skipped: [],
    errors: [],
  };

  console.log("🔄 Updating remote references...");
  try {
    await deps.fetchAndPrune();
  } catch {
    console.log("⚠️  Failed to update remote references (continuing)");
  }

  console.log("📋 Fetching worktree list...");
  const worktrees = await deps.listWorktrees();

  if (worktrees.length === 0) {
    console.log("No worktrees found.");
    return result;
  }

  const statuses = await deps.getWorktreeStatuses(worktrees);

  // Filter out main worktrees for display
  const cleanableStatuses = statuses.filter((s) => !s.worktree.isMain);

  if (cleanableStatuses.length === 0) {
    console.log("No cleanable worktrees found.");
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
      console.log("\n✨ No unnecessary worktrees detected.");
      console.log("Hint: use --all option to show all worktrees.");
      return result;
    }

    console.log("\n🗑️  Deletion candidates:");
    for (const status of autoCleanable) {
      const branch = status.worktree.branch || "(detached)";
      console.log(`  • ${branch}`);
      console.log(`    Path: ${status.worktree.path}`);
      console.log(`    Reason: ${status.reason}`);
    }

    toDelete = autoCleanable;
  }

  if (toDelete.length === 0) {
    console.log("\nNo targets to delete.");
    return result;
  }

  // Dry run mode
  if (args.dryRun) {
    console.log("\n[dry-run] The following worktrees would be deleted:");
    for (const status of toDelete) {
      console.log(`  • ${status.worktree.branch || status.worktree.path}`);
    }
    return result;
  }

  // Confirmation
  if (!args.force) {
    console.log("");
    const confirmed = await deps.confirm(
      `Delete ${toDelete.length} worktree(s)?`
    );
    if (!confirmed) {
      console.log("Cancelled.");
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
    const message = error instanceof Error ? error.message : String(error);
    console.debug(
      `preClean hooks will be skipped: failed to get git context or load project config: ${message}`
    );
  }

  // Execute deletion
  console.log("\n🗑️  Deleting...");
  for (const status of toDelete) {
    const { worktree } = status;
    try {
      // preClean hook
      if (config?.preClean && repoRoot) {
        const hookCmd = deps.buildHookCommand(config.preClean, { path: worktree.path });
        const spinner = args.verbose ? null : startSpinner("Running preClean hook...");
        try {
          await deps.runHook(hookCmd, repoRoot, {
            verbose: args.verbose,
            onLine: spinner ? createTailUpdater(spinner) : undefined,
          });
          spinner?.stop();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          spinner?.fail(`preClean hook failed (continuing): ${message}`);
          console.warn(`  ⚠️  preClean hook failed (continuing): ${message}`);
        }
      }

      await deps.removeWorktree(worktree.path, worktree.isDirty);

      // Delete local branch (skip for detached HEAD)
      if (worktree.branch) {
        try {
          await deps.deleteLocalBranch(worktree.branch, true);
        } catch (error) {
          const branchError = error instanceof Error ? error.message : String(error);
          console.warn(`  ⚠️  Failed to delete branch ${worktree.branch}: ${branchError}`);
        }
      }

      console.log(`  ✓ ${worktree.branch || worktree.path}`);
      result.deleted.push(worktree.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ ${worktree.branch || worktree.path}: ${message}`);
      result.errors.push({ path: worktree.path, error: message });
    }
  }

  // Summary
  console.log("");
  if (result.deleted.length > 0) {
    console.log(`✅ Deleted ${result.deleted.length} worktree(s).`);
  }
  if (result.errors.length > 0) {
    console.log(`⚠️  Failed to delete ${result.errors.length} worktree(s).`);
  }

  return result;
}
