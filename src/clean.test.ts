import { describe, expect, test, mock, spyOn, beforeEach, afterEach } from "bun:test";
import type { CleanArgs } from "./clean";
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

describe("executeClean", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe("dry-run", () => {
    test("削除せずに候補表示のみ", async () => {
      const worktree = createMockWorktree({ branch: "feature/merged" });
      const status = createMockStatus({
        worktree,
        canAutoClean: true,
        branchMerged: true,
        reason: "マージ済み",
      });

      const mockRemoveWorktree = mock(async () => undefined);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree]),
        getWorktreeStatuses: mock(async () => [status]),
        removeWorktree: mockRemoveWorktree,
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: false, all: false, dryRun: true };
      const result = await executeClean(args);

      // removeWorktreeが呼ばれていないことを確認
      expect(mockRemoveWorktree).not.toHaveBeenCalled();
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

      const mockRemoveWorktree = mock(async () => undefined);
      const mockConfirm = mock(async () => true);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree]),
        getWorktreeStatuses: mock(async () => [status]),
        removeWorktree: mockRemoveWorktree,
      }));

      mock.module("./prompt", () => ({
        confirm: mockConfirm,
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args);

      // confirmが呼ばれていないことを確認
      expect(mockConfirm).not.toHaveBeenCalled();
      // removeWorktreeが呼ばれたことを確認
      expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
      expect(result.deleted).toEqual([worktree.path]);
    });
  });

  describe("all", () => {
    test("selectMultipleを使用", async () => {
      const worktree1 = createMockWorktree({ path: "/path/1", branch: "feature/1" });
      const worktree2 = createMockWorktree({ path: "/path/2", branch: "feature/2" });
      const status1 = createMockStatus({ worktree: worktree1, canAutoClean: true });
      const status2 = createMockStatus({ worktree: worktree2, canAutoClean: false });

      const mockSelectMultiple = mock(async () => [status1]);
      const mockRemoveWorktree = mock(async () => undefined);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree1, worktree2]),
        getWorktreeStatuses: mock(async () => [status1, status2]),
        removeWorktree: mockRemoveWorktree,
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mockSelectMultiple,
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: true, all: true, dryRun: false };
      const result = await executeClean(args);

      // selectMultipleが呼ばれたことを確認
      expect(mockSelectMultiple).toHaveBeenCalledTimes(1);
      expect(result.deleted).toEqual([worktree1.path]);
    });

    test("selectMultipleが空配列 - ユーザーキャンセル時は削除しない", async () => {
      const worktree1 = createMockWorktree({ path: "/path/1", branch: "feature/1" });
      const worktree2 = createMockWorktree({ path: "/path/2", branch: "feature/2" });
      const status1 = createMockStatus({ worktree: worktree1, canAutoClean: true });
      const status2 = createMockStatus({ worktree: worktree2, canAutoClean: false });

      const mockSelectMultiple = mock(async () => []); // ユーザーが何も選択しない
      const mockRemoveWorktree = mock(async () => undefined);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree1, worktree2]),
        getWorktreeStatuses: mock(async () => [status1, status2]),
        removeWorktree: mockRemoveWorktree,
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mockSelectMultiple,
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: true, all: true, dryRun: false };
      const result = await executeClean(args);

      // removeWorktreeが呼ばれていないことを確認
      expect(mockRemoveWorktree).not.toHaveBeenCalled();
      expect(result.deleted).toEqual([]);
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

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree]),
        getWorktreeStatuses: mock(async () => [status]),
        removeWorktree: mock(async () => undefined),
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args);

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

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree]),
        getWorktreeStatuses: mock(async () => [status]),
        removeWorktree: mock(async () => {
          throw new Error("削除に失敗しました");
        }),
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args);

      expect(result.deleted).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe("/path/to/error");
      expect(result.errors[0].error).toBe("削除に失敗しました");
    });
  });

  describe("worktreeがない場合", () => {
    test("早期リターン", async () => {
      const mockGetWorktreeStatuses = mock(async () => []);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => []),
        getWorktreeStatuses: mockGetWorktreeStatuses,
        removeWorktree: mock(async () => undefined),
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args);

      expect(result.deleted).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(mockGetWorktreeStatuses).not.toHaveBeenCalled();
    });
  });

  describe("メインworktreeのみの場合", () => {
    test("削除可能なworktreeがない", async () => {
      const mainWorktree = createMockWorktree({ isMain: true, branch: "main" });
      const mainStatus = createMockStatus({ worktree: mainWorktree, reason: "メインworktree" });

      const mockRemoveWorktree = mock(async () => undefined);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [mainWorktree]),
        getWorktreeStatuses: mock(async () => [mainStatus]),
        removeWorktree: mockRemoveWorktree,
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args);

      expect(result.deleted).toEqual([]);
      expect(mockRemoveWorktree).not.toHaveBeenCalled();
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

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree]),
        getWorktreeStatuses: mock(async () => [status]),
        removeWorktree: mock(async () => undefined),
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args);

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

      const mockRemoveWorktree = mock(async () => undefined);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => undefined),
        listWorktrees: mock(async () => [worktree]),
        getWorktreeStatuses: mock(async () => [status]),
        removeWorktree: mockRemoveWorktree,
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => false),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: false, all: false, dryRun: false };
      const result = await executeClean(args);

      expect(mockRemoveWorktree).not.toHaveBeenCalled();
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

      const mockListWorktrees = mock(async () => [worktree]);
      const mockRemoveWorktree = mock(async () => undefined);

      mock.module("./git", () => ({
        fetchAndPrune: mock(async () => {
          throw new Error("Network error");
        }),
        listWorktrees: mockListWorktrees,
        getWorktreeStatuses: mock(async () => [status]),
        removeWorktree: mockRemoveWorktree,
      }));

      mock.module("./prompt", () => ({
        confirm: mock(async () => true),
        selectMultiple: mock(async () => []),
      }));

      const { executeClean } = await import("./clean");

      const args: CleanArgs = { force: true, all: false, dryRun: false };
      const result = await executeClean(args);

      // エラーがあっても続行されることを確認
      expect(mockListWorktrees).toHaveBeenCalledTimes(1);
      expect(result.deleted).toEqual([worktree.path]);
    });
  });
});
