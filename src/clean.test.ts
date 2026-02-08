import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { executeClean, type CleanArgs, type CleanDeps } from "./clean";
import type { WorktreeInfo, WorktreeStatus } from "./git";

// ============================================================================
// ヘルパー関数
// ============================================================================

function makeWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "/tmp/repo-feature-test",
    branch: "feature/test",
    isLocked: false,
    isDirty: false,
    isMain: false,
    ...overrides,
  };
}

function makeStatus(
  worktreeOverrides: Partial<WorktreeInfo> = {},
  statusOverrides: Partial<Omit<WorktreeStatus, "worktree">> = {}
): WorktreeStatus {
  return {
    worktree: makeWorktree(worktreeOverrides),
    branchMerged: false,
    branchDeletedOnRemote: false,
    canAutoClean: false,
    reason: "アクティブ",
    ...statusOverrides,
  };
}

function makeDeps(overrides: Partial<CleanDeps> = {}): CleanDeps {
  return {
    fetchAndPrune: async () => {},
    listWorktrees: async () => [],
    getWorktreeStatuses: async () => [],
    removeWorktree: async () => {},
    deleteLocalBranch: async () => {},
    getGitContext: async () => ({
      repoRoot: "/repo",
      repoName: "repo",
      currentBranch: "main",
    }),
    loadProjectConfig: async () => null,
    buildHookCommand: (template, vars) =>
      template.replace(/\{path\}/g, vars.path),
    runHook: async () => {},
    confirm: async () => true,
    selectMultiple: async () => [],
    ...overrides,
  };
}

const defaultArgs: CleanArgs = { force: false, all: false, dryRun: false };

// console 出力を抑制
let consoleWarnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "debug").mockImplementation(() => {});
});

// ============================================================================
// テスト
// ============================================================================

describe("executeClean", () => {
  describe("worktree が存在しない場合", () => {
    test("空の結果を返す", async () => {
      const deps = makeDeps({
        listWorktrees: async () => [],
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("削除可能な worktree がない場合", () => {
    test("全て main worktree の場合は空の結果を返す", async () => {
      const mainWorktree = makeWorktree({ isMain: true, branch: "main" });
      const deps = makeDeps({
        listWorktrees: async () => [mainWorktree],
        getWorktreeStatuses: async () => [
          makeStatus(
            { isMain: true, branch: "main" },
            { reason: "メインworktree" }
          ),
        ],
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("自動検出モード（--all なし）", () => {
    test("canAutoClean が全て false の場合は空の結果を返す", async () => {
      const worktree = makeWorktree();
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [
          makeStatus({}, { canAutoClean: false, reason: "アクティブ" }),
        ],
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });

    test("canAutoClean な worktree を削除する", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-feature-merged",
        branch: "feature/merged",
      });
      const status = makeStatus(
        { path: "/tmp/repo-feature-merged", branch: "feature/merged" },
        { canAutoClean: true, branchMerged: true, reason: "マージ済み" }
      );
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        confirm: async () => true,
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-feature-merged"]);
      expect(result.errors).toEqual([]);
    });
  });

  describe("--all モード", () => {
    test("selectMultiple で選択した worktree を削除する", async () => {
      const wt1 = makeWorktree({
        path: "/tmp/repo-a",
        branch: "feature/a",
      });
      const wt2 = makeWorktree({
        path: "/tmp/repo-b",
        branch: "feature/b",
      });
      const status1 = makeStatus(
        { path: "/tmp/repo-a", branch: "feature/a" },
        { canAutoClean: false }
      );
      const status2 = makeStatus(
        { path: "/tmp/repo-b", branch: "feature/b" },
        { canAutoClean: true }
      );

      const deps = makeDeps({
        listWorktrees: async () => [wt1, wt2],
        getWorktreeStatuses: async () => [status1, status2],
        selectMultiple: async () => [status2],
        confirm: async () => true,
      });

      const result = await executeClean(
        { ...defaultArgs, all: true, force: true },
        deps
      );

      expect(result.deleted).toEqual(["/tmp/repo-b"]);
    });

    test("selectMultiple で何も選択しない場合は削除しない", async () => {
      const worktree = makeWorktree();
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [makeStatus()],
        selectMultiple: async () => [],
      });

      const result = await executeClean(
        { ...defaultArgs, all: true },
        deps
      );

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("--dry-run モード", () => {
    test("削除せずに結果を返す", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-feature-merged",
        branch: "feature/merged",
      });
      const status = makeStatus(
        { path: "/tmp/repo-feature-merged", branch: "feature/merged" },
        { canAutoClean: true, reason: "マージ済み" }
      );
      let removeWorktreeCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        removeWorktree: async () => {
          removeWorktreeCalled = true;
        },
      });

      const result = await executeClean(
        { ...defaultArgs, dryRun: true },
        deps
      );

      expect(removeWorktreeCalled).toBe(false);
      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("確認プロンプト", () => {
    test("confirm が false を返すと削除しない", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true, reason: "マージ済み" });
      let removeWorktreeCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        confirm: async () => false,
        removeWorktree: async () => {
          removeWorktreeCalled = true;
        },
      });

      const result = await executeClean(defaultArgs, deps);

      expect(removeWorktreeCalled).toBe(false);
      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });

    test("--force で確認をスキップする", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true, reason: "マージ済み" });
      let confirmCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(confirmCalled).toBe(false);
    });
  });

  describe("削除実行", () => {
    test("正常に削除できた worktree を deleted に記録する", async () => {
      const wt1 = makeWorktree({ path: "/tmp/repo-a", branch: "feature/a" });
      const wt2 = makeWorktree({ path: "/tmp/repo-b", branch: "feature/b" });
      const status1 = makeStatus(
        { path: "/tmp/repo-a", branch: "feature/a" },
        { canAutoClean: true }
      );
      const status2 = makeStatus(
        { path: "/tmp/repo-b", branch: "feature/b" },
        { canAutoClean: true }
      );
      const deps = makeDeps({
        listWorktrees: async () => [wt1, wt2],
        getWorktreeStatuses: async () => [status1, status2],
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(result.deleted).toEqual(["/tmp/repo-a", "/tmp/repo-b"]);
      expect(result.errors).toEqual([]);
    });

    test("removeWorktree が失敗した場合は errors に記録する", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-fail",
        branch: "feature/fail",
      });
      const status = makeStatus(
        { path: "/tmp/repo-fail", branch: "feature/fail" },
        { canAutoClean: true }
      );
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        removeWorktree: async () => {
          throw new Error("Permission denied");
        },
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(result.deleted).toEqual([]);
      expect(result.errors).toEqual([
        { path: "/tmp/repo-fail", error: "Permission denied" },
      ]);
    });

    test("dirty な worktree は force=true で removeWorktree を呼ぶ", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-dirty",
        branch: "feature/dirty",
        isDirty: true,
      });
      const status = makeStatus(
        { path: "/tmp/repo-dirty", branch: "feature/dirty", isDirty: true },
        { canAutoClean: true }
      );
      let removedWithForce = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        removeWorktree: async (_path, force) => {
          removedWithForce = force === true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(removedWithForce).toBe(true);
    });

    test("一部の削除が失敗しても他の削除は続行する", async () => {
      const wt1 = makeWorktree({ path: "/tmp/repo-ok", branch: "feature/ok" });
      const wt2 = makeWorktree({
        path: "/tmp/repo-fail",
        branch: "feature/fail",
      });
      const wt3 = makeWorktree({
        path: "/tmp/repo-ok2",
        branch: "feature/ok2",
      });
      const status1 = makeStatus(
        { path: "/tmp/repo-ok", branch: "feature/ok" },
        { canAutoClean: true }
      );
      const status2 = makeStatus(
        { path: "/tmp/repo-fail", branch: "feature/fail" },
        { canAutoClean: true }
      );
      const status3 = makeStatus(
        { path: "/tmp/repo-ok2", branch: "feature/ok2" },
        { canAutoClean: true }
      );
      const deps = makeDeps({
        listWorktrees: async () => [wt1, wt2, wt3],
        getWorktreeStatuses: async () => [status1, status2, status3],
        removeWorktree: async (path) => {
          if (path === "/tmp/repo-fail") {
            throw new Error("Failed");
          }
        },
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(result.deleted).toEqual(["/tmp/repo-ok", "/tmp/repo-ok2"]);
      expect(result.errors).toEqual([
        { path: "/tmp/repo-fail", error: "Failed" },
      ]);
    });
  });

  describe("fetchAndPrune", () => {
    test("fetchAndPrune が失敗しても続行する", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      const deps = makeDeps({
        fetchAndPrune: async () => {
          throw new Error("Network error");
        },
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(result.deleted).toEqual([worktree.path]);
    });
  });

  describe("preClean フック", () => {
    test("config に preClean がある場合フックを実行する", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-hook" });
      const status = makeStatus(
        { path: "/tmp/repo-hook" },
        { canAutoClean: true }
      );
      let hookExecuted = false;
      let hookCommand = "";
      let hookCwd = "";
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "cd {path} && docker-compose down",
        }),
        buildHookCommand: (template, vars) => {
          return template.replace(/\{path\}/g, vars.path);
        },
        runHook: async (cmd, cwd) => {
          hookExecuted = true;
          hookCommand = cmd;
          hookCwd = cwd;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookExecuted).toBe(true);
      expect(hookCommand).toBe(
        "cd /tmp/repo-hook && docker-compose down"
      );
      expect(hookCwd).toBe("/repo");
    });

    test("preClean フックが失敗しても削除を続行する", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-hook-fail" });
      const status = makeStatus(
        { path: "/tmp/repo-hook-fail" },
        { canAutoClean: true }
      );
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "cd {path} && false",
        }),
        runHook: async () => {
          throw new Error("Hook failed");
        },
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(result.deleted).toEqual(["/tmp/repo-hook-fail"]);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test("config が null の場合フックを実行しない", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      let hookCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => null,
        runHook: async () => {
          hookCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookCalled).toBe(false);
    });

    test("getGitContext が失敗した場合フックをスキップする", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      let hookCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        getGitContext: async () => {
          throw new Error("Not a git repo");
        },
        loadProjectConfig: async () => ({
          preClean: "echo cleanup",
        }),
        runHook: async () => {
          hookCalled = true;
        },
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(hookCalled).toBe(false);
      expect(result.deleted).toEqual([worktree.path]);
    });
  });

  describe("branch が null の場合（detached HEAD）", () => {
    test("path をフォールバックとして使用する", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-detached",
        branch: null,
      });
      const status = makeStatus(
        { path: "/tmp/repo-detached", branch: null },
        { canAutoClean: true }
      );
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(result.deleted).toEqual(["/tmp/repo-detached"]);
    });
  });

  describe("ローカルブランチ削除", () => {
    test("worktree 削除後にローカルブランチを force 削除する", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-branch",
        branch: "feature/branch",
      });
      const status = makeStatus(
        { path: "/tmp/repo-branch", branch: "feature/branch" },
        { canAutoClean: true }
      );
      let deletedBranch = "";
      let deletedWithForce = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        deleteLocalBranch: async (branch, force) => {
          deletedBranch = branch;
          deletedWithForce = force === true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(deletedBranch).toBe("feature/branch");
      expect(deletedWithForce).toBe(true);
    });

    test("detached HEAD の場合はブランチ削除をスキップする", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-detached",
        branch: null,
      });
      const status = makeStatus(
        { path: "/tmp/repo-detached", branch: null },
        { canAutoClean: true }
      );
      let deleteLocalBranchCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        deleteLocalBranch: async () => {
          deleteLocalBranchCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(deleteLocalBranchCalled).toBe(false);
    });

    test("ブランチ削除に失敗しても worktree は削除成功として記録する", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-branch-fail",
        branch: "feature/branch-fail",
      });
      const status = makeStatus(
        { path: "/tmp/repo-branch-fail", branch: "feature/branch-fail" },
        { canAutoClean: true }
      );
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        deleteLocalBranch: async () => {
          throw new Error("Branch delete failed");
        },
      });

      const result = await executeClean(
        { ...defaultArgs, force: true },
        deps
      );

      expect(result.deleted).toEqual(["/tmp/repo-branch-fail"]);
      expect(result.errors).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test("--dry-run の場合はブランチ削除しない", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-dry",
        branch: "feature/dry",
      });
      const status = makeStatus(
        { path: "/tmp/repo-dry", branch: "feature/dry" },
        { canAutoClean: true }
      );
      let deleteLocalBranchCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        deleteLocalBranch: async () => {
          deleteLocalBranchCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, dryRun: true }, deps);

      expect(deleteLocalBranchCalled).toBe(false);
    });

    test("removeWorktree が失敗した場合はブランチ削除しない", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-wt-fail",
        branch: "feature/wt-fail",
      });
      const status = makeStatus(
        { path: "/tmp/repo-wt-fail", branch: "feature/wt-fail" },
        { canAutoClean: true }
      );
      let deleteLocalBranchCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        removeWorktree: async () => {
          throw new Error("Worktree remove failed");
        },
        deleteLocalBranch: async () => {
          deleteLocalBranchCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(deleteLocalBranchCalled).toBe(false);
    });
  });
});
