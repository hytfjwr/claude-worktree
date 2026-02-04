import {
  listWorktrees,
  getWorktreeStatuses,
  removeWorktree,
  fetchAndPrune,
  type WorktreeStatus,
} from "./git";
import { confirm, selectMultiple } from "./prompt";

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

export type CleanDependencies = {
  fetchAndPrune: typeof fetchAndPrune;
  listWorktrees: typeof listWorktrees;
  getWorktreeStatuses: typeof getWorktreeStatuses;
  removeWorktree: typeof removeWorktree;
  confirm: typeof confirm;
  selectMultiple: typeof selectMultiple;
  log: typeof console.log;
};

const defaultDependencies: CleanDependencies = {
  fetchAndPrune,
  listWorktrees,
  getWorktreeStatuses,
  removeWorktree,
  confirm,
  selectMultiple,
  log: console.log,
};

export async function executeClean(
  args: CleanArgs,
  deps: CleanDependencies = defaultDependencies
): Promise<CleanResult> {
  const result: CleanResult = {
    deleted: [],
    skipped: [],
    errors: [],
  };

  deps.log("🔄 リモート参照を更新中...");
  try {
    await deps.fetchAndPrune();
  } catch {
    deps.log("⚠️  リモート参照の更新に失敗しました（続行します）");
  }

  deps.log("📋 Worktree一覧を取得中...");
  const worktrees = await deps.listWorktrees();

  if (worktrees.length === 0) {
    deps.log("Worktreeがありません。");
    return result;
  }

  const statuses = await deps.getWorktreeStatuses(worktrees);

  // Filter out main worktrees for display
  const cleanableStatuses = statuses.filter((s) => !s.worktree.isMain);

  if (cleanableStatuses.length === 0) {
    deps.log("削除可能なworktreeがありません。");
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
      deps.log("\n✨ 不要なworktreeは検出されませんでした。");
      deps.log("ヒント: --all オプションで全worktreeを表示できます。");
      return result;
    }

    deps.log("\n🗑️  削除候補:");
    for (const status of autoCleanable) {
      const branch = status.worktree.branch || "(detached)";
      deps.log(`  • ${branch}`);
      deps.log(`    Path: ${status.worktree.path}`);
      deps.log(`    Reason: ${status.reason}`);
    }

    toDelete = autoCleanable;
  }

  if (toDelete.length === 0) {
    deps.log("\n削除対象がありません。");
    return result;
  }

  // Dry run mode
  if (args.dryRun) {
    deps.log("\n[dry-run] 以下のworktreeが削除されます:");
    for (const status of toDelete) {
      deps.log(`  • ${status.worktree.branch || status.worktree.path}`);
    }
    return result;
  }

  // Confirmation
  if (!args.force) {
    deps.log("");
    const confirmed = await deps.confirm(
      `${toDelete.length}個のworktreeを削除しますか？`
    );
    if (!confirmed) {
      deps.log("キャンセルしました。");
      return result;
    }
  }

  // Execute deletion
  deps.log("\n🗑️  削除中...");
  for (const status of toDelete) {
    const { worktree } = status;
    try {
      await deps.removeWorktree(worktree.path, worktree.isDirty);
      deps.log(`  ✓ ${worktree.branch || worktree.path}`);
      result.deleted.push(worktree.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log(`  ✗ ${worktree.branch || worktree.path}: ${message}`);
      result.errors.push({ path: worktree.path, error: message });
    }
  }

  // Summary
  deps.log("");
  if (result.deleted.length > 0) {
    deps.log(`✅ ${result.deleted.length}個のworktreeを削除しました。`);
  }
  if (result.errors.length > 0) {
    deps.log(`⚠️  ${result.errors.length}個のworktreeの削除に失敗しました。`);
  }

  return result;
}
