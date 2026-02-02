import { describe, expect, test, mock } from "bun:test";
import { executeClean, type CleanDependencies, type CleanArgs } from "./clean";
import type { WorktreeInfo, WorktreeStatus } from "./git";

// テスト用ヘルパー関数
function createMockWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "/path/to/worktree",
    branch: "feature/test",
    isLocked: false,
    isDirty: false,
    isMain: false,
    ...overrides,
  };
}

function createMockStatus(overrides: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    worktree: createMockWorktree(),
    branchMerged: false,
    branchDeletedOnRemote: false,
    canAutoClean: false,
    reason: "アクティブ",
    ...overrides,
  };
}

function createMockDeps(overrides: Partial<CleanDependencies> = {}): CleanDependencies {
  return {
    fetchAndPrune: mock(() => Promise.resolve()),
    listWorktrees: mock(() => Promise.resolve([])),
    getWorktreeStatuses: mock(() => Promise.resolve([])),
    removeWorktree: mock(() => Promise.resolve()),
    confirm: mock(() => Promise.resolve(true)),
    selectMultiple: mock(() => Promise.resolve([])),
    log: mock(() => {}),
    ...overrides,
  };
}

describe("executeClean", () => {
  describe("dry-run", () => {
    test("削除せずに候補表示のみ", async () => {
      const worktree = createMockWorktree({ branch: "feature/merged" });
      const status = createMockStatus({
        worktree,
        canAutoClean: true,
        branchMerged: true,
        reason: "マージ済み",
      });

      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([worktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([status])),
      });

      const args: CleanArgs = { force: false, all: false, dryRun: true };
      const result = await executeClean(args, deps);

      // removeWorktreeが呼ばれていないことを確認
      expect(deps.removeWorktree).not.toHaveBeenCalled();
      // 削除されたworktreeがないことを確認
      expect(result.deleted).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  describe("force", () => {
    test("確認スキップで即削除", async () => {
      const worktree = createMockWorktree({ branch: "feature/merged" });
      const status = createMockStatus({
        worktree,
        canAutoClean: true,
        branchMerged: true,
        reason: "マージ済み",
      });

      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([worktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([status])),
      });

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      // confirmが呼ばれていないことを確認
      expect(deps.confirm).not.toHaveBeenCalled();
      // removeWorktreeが呼ばれたことを確認
      expect(deps.removeWorktree).toHaveBeenCalledTimes(1);
      expect(result.deleted).toEqual([worktree.path]);
    });
  });

  describe("all", () => {
    test("selectMultipleを使用", async () => {
      const worktree1 = createMockWorktree({ path: "/path/1", branch: "feature/1" });
      const worktree2 = createMockWorktree({ path: "/path/2", branch: "feature/2" });
      const status1 = createMockStatus({ worktree: worktree1, canAutoClean: true });
      const status2 = createMockStatus({ worktree: worktree2, canAutoClean: false });

      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([worktree1, worktree2])),
        getWorktreeStatuses: mock(() => Promise.resolve([status1, status2])),
        selectMultiple: mock(() => Promise.resolve([status1])),
      });

      const args: CleanArgs = { force: true, all: true, dryRun: false };
      const result = await executeClean(args, deps);

      // selectMultipleが呼ばれたことを確認
      expect(deps.selectMultiple).toHaveBeenCalledTimes(1);
      expect(result.deleted).toEqual([worktree1.path]);
    });
  });

  describe("成功時", () => {
    test("deleted配列に追加", async () => {
      const worktree = createMockWorktree({ path: "/path/to/delete" });
      const status = createMockStatus({
        worktree,
        canAutoClean: true,
        reason: "マージ済み",
      });

      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([worktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([status])),
      });

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      expect(result.deleted).toContain("/path/to/delete");
      expect(result.errors).toEqual([]);
    });
  });

  describe("エラー時", () => {
    test("errors配列に追加", async () => {
      const worktree = createMockWorktree({ path: "/path/to/error" });
      const status = createMockStatus({
        worktree,
        canAutoClean: true,
        reason: "マージ済み",
      });

      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([worktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([status])),
        removeWorktree: mock(() => Promise.reject(new Error("削除に失敗しました"))),
      });

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      expect(result.deleted).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe("/path/to/error");
      expect(result.errors[0].error).toBe("削除に失敗しました");
    });
  });

  describe("worktreeがない場合", () => {
    test("早期リターン", async () => {
      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([])),
      });

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      expect(result.deleted).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(deps.getWorktreeStatuses).not.toHaveBeenCalled();
    });
  });

  describe("メインworktreeのみの場合", () => {
    test("削除可能なworktreeがない", async () => {
      const mainWorktree = createMockWorktree({ isMain: true, branch: "main" });
      const mainStatus = createMockStatus({ worktree: mainWorktree, reason: "メインworktree" });

      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([mainWorktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([mainStatus])),
      });

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      expect(result.deleted).toEqual([]);
      expect(deps.removeWorktree).not.toHaveBeenCalled();
    });
  });

  describe("auto-cleanableがない場合", () => {
    test("不要なworktreeは検出されませんでしたと表示", async () => {
      const worktree = createMockWorktree({ branch: "feature/active" });
      const status = createMockStatus({
        worktree,
        canAutoClean: false,
        reason: "アクティブ",
      });

      const logs: string[] = [];
      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([worktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([status])),
        log: mock((msg: string) => logs.push(msg)),
      });

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      expect(result.deleted).toEqual([]);
      expect(logs.some((l) => l.includes("不要なworktreeは検出されませんでした"))).toBe(true);
    });
  });

  describe("ユーザーがキャンセルした場合", () => {
    test("削除しない", async () => {
      const worktree = createMockWorktree({ branch: "feature/merged" });
      const status = createMockStatus({
        worktree,
        canAutoClean: true,
        reason: "マージ済み",
      });

      const deps = createMockDeps({
        listWorktrees: mock(() => Promise.resolve([worktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([status])),
        confirm: mock(() => Promise.resolve(false)),
      });

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      expect(deps.removeWorktree).not.toHaveBeenCalled();
      expect(result.deleted).toEqual([]);
    });
  });

  describe("fetchAndPruneが失敗した場合", () => {
    test("続行する", async () => {
      const worktree = createMockWorktree({ branch: "feature/merged" });
      const status = createMockStatus({
        worktree,
        canAutoClean: true,
        reason: "マージ済み",
      });

      const deps = createMockDeps({
        fetchAndPrune: mock(() => Promise.reject(new Error("Network error"))),
        listWorktrees: mock(() => Promise.resolve([worktree])),
        getWorktreeStatuses: mock(() => Promise.resolve([status])),
      });

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args, deps);

      // エラーがあっても続行されることを確認
      expect(deps.listWorktrees).toHaveBeenCalledTimes(1);
      expect(result.deleted).toEqual([worktree.path]);
    });
  });
});
