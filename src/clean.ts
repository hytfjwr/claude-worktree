import {
  getGitContext,
  listWorktrees,
  getWorktreeStatuses,
  removeWorktree,
  fetchAndPrune,
  type WorktreeInfo,
  type WorktreeStatus,
  type GitContext,
} from "./git";
import { confirm, selectMultiple } from "./prompt";
import { loadProjectConfig, buildHookCommand, runHook, type ProjectConfig, type HookVars } from "./config";

export type CleanArgs = {
  force: boolean;
  all: boolean;
  dryRun: boolean;
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
  getGitContext: () => Promise<GitContext>;
  loadProjectConfig: (repoRoot: string) => Promise<ProjectConfig | null>;
  buildHookCommand: (template: string, vars: HookVars) => string;
  runHook: (command: string, cwd: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  selectMultiple: (statuses: WorktreeStatus[]) => Promise<WorktreeStatus[]>;
};

const defaultDeps: CleanDeps = {
  fetchAndPrune,
  listWorktrees,
  getWorktreeStatuses,
  removeWorktree,
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

  console.log("🔄 リモート参照を更新中...");
  try {
    await deps.fetchAndPrune();
  } catch {
    console.log("⚠️  リモート参照の更新に失敗しました（続行します）");
  }

  console.log("📋 Worktree一覧を取得中...");
  const worktrees = await deps.listWorktrees();

  if (worktrees.length === 0) {
    console.log("Worktreeがありません。");
    return result;
  }

  const statuses = await deps.getWorktreeStatuses(worktrees);

  // Filter out main worktrees for display
  const cleanableStatuses = statuses.filter((s) => !s.worktree.isMain);

  if (cleanableStatuses.length === 0) {
    console.log("削除可能なworktreeがありません。");
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
      console.log("\n✨ 不要なworktreeは検出されませんでした。");
      console.log("ヒント: --all オプションで全worktreeを表示できます。");
      return result;
    }

    console.log("\n🗑️  削除候補:");
    for (const status of autoCleanable) {
      const branch = status.worktree.branch || "(detached)";
      console.log(`  • ${branch}`);
      console.log(`    Path: ${status.worktree.path}`);
      console.log(`    Reason: ${status.reason}`);
    }

    toDelete = autoCleanable;
  }

  if (toDelete.length === 0) {
    console.log("\n削除対象がありません。");
    return result;
  }

  // Dry run mode
  if (args.dryRun) {
    console.log("\n[dry-run] 以下のworktreeが削除されます:");
    for (const status of toDelete) {
      console.log(`  • ${status.worktree.branch || status.worktree.path}`);
    }
    return result;
  }

  // Confirmation
  if (!args.force) {
    console.log("");
    const confirmed = await deps.confirm(
      `${toDelete.length}個のworktreeを削除しますか？`
    );
    if (!confirmed) {
      console.log("キャンセルしました。");
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
  console.log("\n🗑️  削除中...");
  for (const status of toDelete) {
    const { worktree } = status;
    try {
      // preClean hook
      if (config?.preClean && repoRoot) {
        const hookCmd = deps.buildHookCommand(config.preClean, { path: worktree.path });
        try {
          await deps.runHook(hookCmd, repoRoot);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`  ⚠️  preClean hook failed (continuing): ${message}`);
        }
      }

      await deps.removeWorktree(worktree.path, worktree.isDirty);
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
    console.log(`✅ ${result.deleted.length}個のworktreeを削除しました。`);
  }
  if (result.errors.length > 0) {
    console.log(`⚠️  ${result.errors.length}個のworktreeの削除に失敗しました。`);
  }

  return result;
}
