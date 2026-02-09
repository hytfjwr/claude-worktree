import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import { executeClean } from "./clean";
import type { CleanArgs, CleanDeps, WorktreeInfo, WorktreeStatus } from "./types";

// ============================================================================
// Helper functions
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
  statusOverrides: Partial<Omit<WorktreeStatus, "worktree">> = {},
): WorktreeStatus {
  return {
    worktree: makeWorktree(worktreeOverrides),
    branchMerged: false,
    branchDeletedOnRemote: false,
    canAutoClean: false,
    reason: "Active",
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
    buildHookCommand: (template, vars) => template.replace(/\{path\}/g, vars.path),
    runHook: async () => {},
    confirm: async () => true,
    selectMultiple: async () => [],
    ...overrides,
  };
}

const defaultArgs: CleanArgs = { force: false, all: false, dryRun: false, verbose: false };

// Suppress console output
let consoleWarnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "debug").mockImplementation(() => {});
});

// ============================================================================
// Tests
// ============================================================================

describe("executeClean", () => {
  describe("when no worktrees exist", () => {
    test("returns empty result", async () => {
      const deps = makeDeps({
        listWorktrees: async () => [],
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("when no cleanable worktrees exist", () => {
    test("returns empty result when all are main worktrees", async () => {
      const mainWorktree = makeWorktree({ isMain: true, branch: "main" });
      const deps = makeDeps({
        listWorktrees: async () => [mainWorktree],
        getWorktreeStatuses: async () => [makeStatus({ isMain: true, branch: "main" }, { reason: "Main worktree" })],
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("auto-detect mode (without --all)", () => {
    test("returns empty result when all canAutoClean are false", async () => {
      const worktree = makeWorktree();
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [makeStatus({}, { canAutoClean: false, reason: "Active" })],
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });

    test("deletes canAutoClean worktrees", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-feature-merged",
        branch: "feature/merged",
      });
      const status = makeStatus(
        { path: "/tmp/repo-feature-merged", branch: "feature/merged" },
        { canAutoClean: true, branchMerged: true, reason: "Merged" },
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

  describe("--all mode", () => {
    test("deletes worktrees selected via selectMultiple", async () => {
      const wt1 = makeWorktree({
        path: "/tmp/repo-a",
        branch: "feature/a",
      });
      const wt2 = makeWorktree({
        path: "/tmp/repo-b",
        branch: "feature/b",
      });
      const status1 = makeStatus({ path: "/tmp/repo-a", branch: "feature/a" }, { canAutoClean: false });
      const status2 = makeStatus({ path: "/tmp/repo-b", branch: "feature/b" }, { canAutoClean: true });

      const deps = makeDeps({
        listWorktrees: async () => [wt1, wt2],
        getWorktreeStatuses: async () => [status1, status2],
        selectMultiple: async () => [status2],
        confirm: async () => true,
      });

      const result = await executeClean({ ...defaultArgs, all: true, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-b"]);
    });

    test("does not delete when nothing selected via selectMultiple", async () => {
      const worktree = makeWorktree();
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [makeStatus()],
        selectMultiple: async () => [],
      });

      const result = await executeClean({ ...defaultArgs, all: true }, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("--dry-run mode", () => {
    test("returns result without deleting", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-feature-merged",
        branch: "feature/merged",
      });
      const status = makeStatus(
        { path: "/tmp/repo-feature-merged", branch: "feature/merged" },
        { canAutoClean: true, reason: "Merged" },
      );
      let removeWorktreeCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        removeWorktree: async () => {
          removeWorktreeCalled = true;
        },
      });

      const result = await executeClean({ ...defaultArgs, dryRun: true }, deps);

      expect(removeWorktreeCalled).toBe(false);
      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("confirmation prompt", () => {
    test("does not delete when confirm returns false", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true, reason: "Merged" });
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

    test("--force skips confirmation", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true, reason: "Merged" });
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

  describe("deletion execution", () => {
    test("records successfully deleted worktrees in deleted", async () => {
      const wt1 = makeWorktree({ path: "/tmp/repo-a", branch: "feature/a" });
      const wt2 = makeWorktree({ path: "/tmp/repo-b", branch: "feature/b" });
      const status1 = makeStatus({ path: "/tmp/repo-a", branch: "feature/a" }, { canAutoClean: true });
      const status2 = makeStatus({ path: "/tmp/repo-b", branch: "feature/b" }, { canAutoClean: true });
      const deps = makeDeps({
        listWorktrees: async () => [wt1, wt2],
        getWorktreeStatuses: async () => [status1, status2],
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-a", "/tmp/repo-b"]);
      expect(result.errors).toEqual([]);
    });

    test("records failed removeWorktree in errors", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-fail",
        branch: "feature/fail",
      });
      const status = makeStatus({ path: "/tmp/repo-fail", branch: "feature/fail" }, { canAutoClean: true });
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        removeWorktree: async () => {
          throw new Error("Permission denied");
        },
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual([]);
      expect(result.errors).toEqual([{ path: "/tmp/repo-fail", error: "Permission denied" }]);
    });

    test("dirty worktree calls removeWorktree with force=true", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-dirty",
        branch: "feature/dirty",
        isDirty: true,
      });
      const status = makeStatus(
        { path: "/tmp/repo-dirty", branch: "feature/dirty", isDirty: true },
        { canAutoClean: true },
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

    test("continues deleting others when some deletions fail", async () => {
      const wt1 = makeWorktree({ path: "/tmp/repo-ok", branch: "feature/ok" });
      const wt2 = makeWorktree({
        path: "/tmp/repo-fail",
        branch: "feature/fail",
      });
      const wt3 = makeWorktree({
        path: "/tmp/repo-ok2",
        branch: "feature/ok2",
      });
      const status1 = makeStatus({ path: "/tmp/repo-ok", branch: "feature/ok" }, { canAutoClean: true });
      const status2 = makeStatus({ path: "/tmp/repo-fail", branch: "feature/fail" }, { canAutoClean: true });
      const status3 = makeStatus({ path: "/tmp/repo-ok2", branch: "feature/ok2" }, { canAutoClean: true });
      const deps = makeDeps({
        listWorktrees: async () => [wt1, wt2, wt3],
        getWorktreeStatuses: async () => [status1, status2, status3],
        removeWorktree: async (path) => {
          if (path === "/tmp/repo-fail") {
            throw new Error("Failed");
          }
        },
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-ok", "/tmp/repo-ok2"]);
      expect(result.errors).toEqual([{ path: "/tmp/repo-fail", error: "Failed" }]);
    });
  });

  describe("fetchAndPrune", () => {
    test("continues even when fetchAndPrune fails", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      const deps = makeDeps({
        fetchAndPrune: async () => {
          throw new Error("Network error");
        },
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual([worktree.path]);
    });
  });

  describe("preClean hook", () => {
    test("executes hook when config has preClean", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-hook" });
      const status = makeStatus({ path: "/tmp/repo-hook" }, { canAutoClean: true });
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
      expect(hookCommand).toBe("cd /tmp/repo-hook && docker-compose down");
      expect(hookCwd).toBe("/repo");
    });

    test("continues deletion even when preClean hook fails", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-hook-fail" });
      const status = makeStatus({ path: "/tmp/repo-hook-fail" }, { canAutoClean: true });
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

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-hook-fail"]);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test("does not execute hook when config is null", async () => {
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

    test("skips hook when getGitContext fails", async () => {
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

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookCalled).toBe(false);
      expect(result.deleted).toEqual([worktree.path]);
    });
  });

  describe("when branch is null (detached HEAD)", () => {
    test("uses path as fallback", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-detached",
        branch: null,
      });
      const status = makeStatus({ path: "/tmp/repo-detached", branch: null }, { canAutoClean: true });
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-detached"]);
    });
  });

  describe("local branch deletion", () => {
    test("force deletes local branch after worktree removal", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-branch",
        branch: "feature/branch",
      });
      const status = makeStatus({ path: "/tmp/repo-branch", branch: "feature/branch" }, { canAutoClean: true });
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

    test("skips branch deletion for detached HEAD", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-detached",
        branch: null,
      });
      const status = makeStatus({ path: "/tmp/repo-detached", branch: null }, { canAutoClean: true });
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

    test("records worktree as deleted even when branch deletion fails", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-branch-fail",
        branch: "feature/branch-fail",
      });
      const status = makeStatus(
        { path: "/tmp/repo-branch-fail", branch: "feature/branch-fail" },
        { canAutoClean: true },
      );
      const deps = makeDeps({
        listWorktrees: async () => [worktree],
        getWorktreeStatuses: async () => [status],
        deleteLocalBranch: async () => {
          throw new Error("Branch delete failed");
        },
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-branch-fail"]);
      expect(result.errors).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test("does not delete branch in --dry-run mode", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-dry",
        branch: "feature/dry",
      });
      const status = makeStatus({ path: "/tmp/repo-dry", branch: "feature/dry" }, { canAutoClean: true });
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

    test("does not delete branch when removeWorktree fails", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-wt-fail",
        branch: "feature/wt-fail",
      });
      const status = makeStatus({ path: "/tmp/repo-wt-fail", branch: "feature/wt-fail" }, { canAutoClean: true });
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
