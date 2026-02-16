import { beforeEach, describe, expect, test, vi } from "vitest";

import type { CleanArgs, CleanDeps, WorktreeInfo, WorktreeStatus } from "../types/index.ts";
import { executeClean } from "./clean.ts";

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

function makeSpinner() {
  return {
    stop: vi.fn(),
    fail: vi.fn(),
    updateTail: vi.fn(),
    isExpanded: () => false,
  };
}

function makeDeps(overrides: Partial<CleanDeps> = {}): CleanDeps {
  return {
    fetchAndPrune: async () => {},
    listWorktrees: async () => ({ worktrees: [], mainBranch: "main" }),
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
      template.replace(/\{path\}/g, vars.path).replace(/\{slot\}/g, vars.slot !== undefined ? String(vars.slot) : ""),
    runHook: async () => {},
    readSlot: async () => undefined,
    deleteSlot: async () => {},
    deleteSession: async () => {},
    confirm: async () => true,
    selectMultiple: async () => [],
    startSpinner: () => makeSpinner(),
    checkGhAvailable: async () => false,
    getPullRequestForBranch: async () => null,
    ...overrides,
  };
}

const defaultArgs: CleanArgs = { force: false, all: false, dryRun: false, verbose: false };

// Suppress console output
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

// ============================================================================
// Tests
// ============================================================================

describe("executeClean", () => {
  describe("when no worktrees exist", () => {
    test("returns empty result", async () => {
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [], mainBranch: "main" }),
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("when no cleanable worktrees exist", () => {
    test("returns empty result when all are main worktrees", async () => {
      const mainWorktree = makeWorktree({ isMain: true, branch: "main" });
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [mainWorktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [makeStatus({ isMain: true, branch: "main" }, { reason: "Main worktree" })],
      });

      const result = await executeClean(defaultArgs, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("auto-detect mode (without -all)", () => {
    test("returns empty result when all canAutoClean are false", async () => {
      const worktree = makeWorktree();
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        confirm: async () => true,
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-feature-merged"]);
      expect(result.errors).toEqual([]);
    });
  });

  describe("-all mode", () => {
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
        listWorktrees: async () => ({ worktrees: [wt1, wt2], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [makeStatus()],
        selectMultiple: async () => [],
      });

      const result = await executeClean({ ...defaultArgs, all: true }, deps);

      expect(result).toEqual({ deleted: [], skipped: [], errors: [] });
    });
  });

  describe("-dry-run mode", () => {
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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

    test("-force skips confirmation", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true, reason: "Merged" });
      let confirmCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [wt1, wt2], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [wt1, wt2, wt3], mainBranch: "main" }),
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
    test("skips fetchAndPrune in dry-run mode", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      let fetchCalled = false;
      const deps = makeDeps({
        fetchAndPrune: async () => {
          fetchCalled = true;
        },
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
      });

      await executeClean({ ...defaultArgs, dryRun: true }, deps);

      expect(fetchCalled).toBe(false);
    });

    test("continues even when fetchAndPrune fails", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      const deps = makeDeps({
        fetchAndPrune: async () => {
          throw new Error("Network error");
        },
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => null,
        runHook: async () => {
          hookCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookCalled).toBe(false);
    });

    test("passes timeout option to runHook", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-timeout" });
      const status = makeStatus({ path: "/tmp/repo-timeout" }, { canAutoClean: true });
      let receivedTimeout: number | undefined;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "cd {path} && docker-compose down",
          preCleanTimeout: 120,
        }),
        runHook: async (_cmd, _cwd, options) => {
          receivedTimeout = options?.timeout;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(receivedTimeout).toBe(120);
    });

    test("passes global hookTimeout when hook-specific timeout is not set", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-global-timeout" });
      const status = makeStatus({ path: "/tmp/repo-global-timeout" }, { canAutoClean: true });
      let receivedTimeout: number | undefined;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "cd {path} && docker-compose down",
          hookTimeout: 300,
        }),
        runHook: async (_cmd, _cwd, options) => {
          receivedTimeout = options?.timeout;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(receivedTimeout).toBe(300);
    });

    test("skips hook when getGitContext fails", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      let hookCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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

  describe("postClean hook", () => {
    test("executes hook after worktree and branch deletion", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-post-hook", branch: "feature/post-hook" });
      const status = makeStatus({ path: "/tmp/repo-post-hook", branch: "feature/post-hook" }, { canAutoClean: true });
      const callOrder: string[] = [];
      let hookCommand = "";
      let hookCwd = "";
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          postClean: "docker volume rm {path}-data || true",
        }),
        buildHookCommand: (template, vars) => {
          return template.replace(/\{path\}/g, vars.path);
        },
        removeWorktree: async () => {
          callOrder.push("removeWorktree");
        },
        deleteLocalBranch: async () => {
          callOrder.push("deleteLocalBranch");
        },
        runHook: async (cmd, cwd) => {
          callOrder.push("runHook:postClean");
          hookCommand = cmd;
          hookCwd = cwd;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(callOrder).toEqual(["removeWorktree", "deleteLocalBranch", "runHook:postClean"]);
      expect(hookCommand).toBe("docker volume rm /tmp/repo-post-hook-data || true");
      expect(hookCwd).toBe("/repo");
    });

    test("continues even when postClean hook fails", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-post-fail" });
      const status = makeStatus({ path: "/tmp/repo-post-fail" }, { canAutoClean: true });
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          postClean: "false",
        }),
        runHook: async () => {
          throw new Error("postClean hook failed");
        },
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-post-fail"]);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test("does not execute hook when config is null", async () => {
      const worktree = makeWorktree();
      const status = makeStatus({}, { canAutoClean: true });
      let hookCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => null,
        runHook: async () => {
          hookCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookCalled).toBe(false);
    });

    test("passes timeout option to runHook", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-post-timeout" });
      const status = makeStatus({ path: "/tmp/repo-post-timeout" }, { canAutoClean: true });
      let receivedTimeout: number | undefined;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          postClean: "echo done",
          postCleanTimeout: 60,
        }),
        runHook: async (_cmd, _cwd, options) => {
          receivedTimeout = options?.timeout;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(receivedTimeout).toBe(60);
    });

    test("runs both preClean and postClean hooks in order", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-both-hooks" });
      const status = makeStatus({ path: "/tmp/repo-both-hooks" }, { canAutoClean: true });
      const hookOrder: string[] = [];
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "echo pre",
          postClean: "echo post",
        }),
        runHook: async (cmd) => {
          hookOrder.push(cmd);
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookOrder).toEqual(["echo pre", "echo post"]);
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-detached"]);
    });
  });

  describe("slot cache integration", () => {
    test("passes readSlot result to buildHookCommand for preClean and postClean", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-slot" });
      const status = makeStatus({ path: "/tmp/repo-slot" }, { canAutoClean: true });
      const hookCommands: string[] = [];
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "cd {path} && docker-compose -p app-{slot} down",
          postClean: "docker volume rm app-{slot}-data || true",
        }),
        readSlot: async () => 3,
        runHook: async (cmd) => {
          hookCommands.push(cmd);
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookCommands).toEqual([
        "cd /tmp/repo-slot && docker-compose -p app-3 down",
        "docker volume rm app-3-data || true",
      ]);
    });

    test("passes undefined slot when readSlot returns undefined", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-no-slot" });
      const status = makeStatus({ path: "/tmp/repo-no-slot" }, { canAutoClean: true });
      const hookCommands: string[] = [];
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "cd {path} && docker-compose -p app-{slot} down",
        }),
        readSlot: async () => undefined,
        runHook: async (cmd) => {
          hookCommands.push(cmd);
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(hookCommands).toEqual(["cd /tmp/repo-no-slot && docker-compose -p app- down"]);
    });

    test("calls deleteSlot after successful clean", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-delete-slot" });
      const status = makeStatus({ path: "/tmp/repo-delete-slot" }, { canAutoClean: true });
      const deletedSlotPaths: string[] = [];
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        readSlot: async () => 5,
        deleteSlot: async (path) => {
          deletedSlotPaths.push(path);
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(deletedSlotPaths).toEqual(["/tmp/repo-delete-slot"]);
    });

    test("same slot is passed to both preClean and postClean", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-same-slot" });
      const status = makeStatus({ path: "/tmp/repo-same-slot" }, { canAutoClean: true });
      const receivedVars: Array<{ path: string; slot?: number }> = [];
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        loadProjectConfig: async () => ({
          preClean: "pre {slot}",
          postClean: "post {slot}",
        }),
        readSlot: async () => 7,
        buildHookCommand: (template, vars) => {
          receivedVars.push({ ...vars });
          return template
            .replace(/\{path\}/g, vars.path)
            .replace(/\{slot\}/g, vars.slot !== undefined ? String(vars.slot) : "");
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(receivedVars).toHaveLength(2);
      expect(receivedVars[0].slot).toBe(7);
      expect(receivedVars[1].slot).toBe(7);
    });
  });

  describe("session cleanup", () => {
    test("calls deleteSession after successful clean", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-session" });
      const status = makeStatus({ path: "/tmp/repo-session" }, { canAutoClean: true });
      const deletedSessionPaths: string[] = [];
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        deleteSession: async (path) => {
          deletedSessionPaths.push(path);
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(deletedSessionPaths).toEqual(["/tmp/repo-session"]);
    });

    test("does not call deleteSession in dry-run mode", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-dry-session" });
      const status = makeStatus({ path: "/tmp/repo-dry-session" }, { canAutoClean: true });
      let deleteSessionCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        deleteSession: async () => {
          deleteSessionCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, dryRun: true }, deps);

      expect(deleteSessionCalled).toBe(false);
    });

    test("does not call deleteSession when removeWorktree fails", async () => {
      const worktree = makeWorktree({ path: "/tmp/repo-fail-session" });
      const status = makeStatus({ path: "/tmp/repo-fail-session" }, { canAutoClean: true });
      let deleteSessionCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        removeWorktree: async () => {
          throw new Error("Failed");
        },
        deleteSession: async () => {
          deleteSessionCalled = true;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(deleteSessionCalled).toBe(false);
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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

    test("does not delete branch in -dry-run mode", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-dry",
        branch: "feature/dry",
      });
      const status = makeStatus({ path: "/tmp/repo-dry", branch: "feature/dry" }, { canAutoClean: true });
      let deleteLocalBranchCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
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

  describe("PR information display", () => {
    test("shows PR info in auto-detect mode when gh is available", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-feature-merged",
        branch: "feature/merged",
      });
      const status = makeStatus(
        { path: "/tmp/repo-feature-merged", branch: "feature/merged" },
        { canAutoClean: true, branchMerged: true, reason: "Merged" },
      );
      const logSpy = vi.spyOn(console, "log");
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        checkGhAvailable: async () => true,
        getPullRequestForBranch: async (branch) => {
          if (branch === "feature/merged") {
            return {
              number: 123,
              title: "Fix login bug",
              state: "MERGED",
              url: "https://github.com/owner/repo/pull/123",
            };
          }
          return null;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      const logCalls = logSpy.mock.calls.map((c) => c[0]);
      expect(logCalls.some((msg) => typeof msg === "string" && msg.includes("PR: #123"))).toBe(true);
      expect(logCalls.some((msg) => typeof msg === "string" && msg.includes("Fix login bug"))).toBe(true);
      expect(logCalls.some((msg) => typeof msg === "string" && msg.includes("MERGED"))).toBe(true);
    });

    test("skips PR lookup when gh is not available", async () => {
      const worktree = makeWorktree({ branch: "feature/test" });
      const status = makeStatus({ branch: "feature/test" }, { canAutoClean: true, reason: "Merged" });
      let getPrCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        checkGhAvailable: async () => false,
        getPullRequestForBranch: async () => {
          getPrCalled = true;
          return null;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(getPrCalled).toBe(false);
    });

    test("continues deletion when PR lookup returns null", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-pr-fail",
        branch: "feature/pr-fail",
      });
      const status = makeStatus(
        { path: "/tmp/repo-pr-fail", branch: "feature/pr-fail" },
        { canAutoClean: true, reason: "Merged" },
      );
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        checkGhAvailable: async () => true,
        getPullRequestForBranch: async () => null,
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(result.deleted).toEqual(["/tmp/repo-pr-fail"]);
    });

    test("continues deletion when getPullRequestForBranch throws", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-pr-throw",
        branch: "feature/pr-throw",
      });
      const status = makeStatus(
        { path: "/tmp/repo-pr-throw", branch: "feature/pr-throw" },
        { canAutoClean: true, reason: "Merged" },
      );
      const spinner = makeSpinner();
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        checkGhAvailable: async () => true,
        getPullRequestForBranch: async () => {
          throw new Error("Network error");
        },
        startSpinner: () => spinner,
      });

      const result = await executeClean({ ...defaultArgs, force: true }, deps);

      expect(spinner.fail).toHaveBeenCalledWith("Failed to fetch PR information (continuing)");
      expect(result.deleted).toEqual(["/tmp/repo-pr-throw"]);
    });

    test("skips PR lookup for detached HEAD (branch null)", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-detached",
        branch: null,
      });
      const status = makeStatus({ path: "/tmp/repo-detached", branch: null }, { canAutoClean: true });
      let getPrCalled = false;
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        checkGhAvailable: async () => true,
        getPullRequestForBranch: async () => {
          getPrCalled = true;
          return null;
        },
      });

      await executeClean({ ...defaultArgs, force: true }, deps);

      expect(getPrCalled).toBe(false);
    });

    test("shows PR info in dry-run mode", async () => {
      const worktree = makeWorktree({
        path: "/tmp/repo-dry-pr",
        branch: "feature/dry-pr",
      });
      const status = makeStatus(
        { path: "/tmp/repo-dry-pr", branch: "feature/dry-pr" },
        { canAutoClean: true, reason: "Remote deleted" },
      );
      const logSpy = vi.spyOn(console, "log");
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [worktree], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        checkGhAvailable: async () => true,
        getPullRequestForBranch: async () => ({
          number: 456,
          title: "Add feature",
          state: "CLOSED",
          url: "https://github.com/owner/repo/pull/456",
        }),
      });

      await executeClean({ ...defaultArgs, dryRun: true }, deps);

      const logCalls = logSpy.mock.calls.map((c) => c[0]);
      expect(logCalls.some((msg) => typeof msg === "string" && msg.includes("PR: #456"))).toBe(true);
    });

    test("includes PR info in hint for -all mode", async () => {
      const wt = makeWorktree({ path: "/tmp/repo-all-pr", branch: "feature/all-pr" });
      const status = makeStatus(
        { path: "/tmp/repo-all-pr", branch: "feature/all-pr" },
        { canAutoClean: false, reason: "Active" },
      );
      let receivedStatuses: WorktreeStatus[] = [];
      const deps = makeDeps({
        listWorktrees: async () => ({ worktrees: [wt], mainBranch: "main" }),
        getWorktreeStatuses: async () => [status],
        checkGhAvailable: async () => true,
        getPullRequestForBranch: async () => ({
          number: 789,
          title: "New feature",
          state: "OPEN",
          url: "https://github.com/owner/repo/pull/789",
        }),
        selectMultiple: async (statuses) => {
          receivedStatuses = statuses;
          return [];
        },
      });

      await executeClean({ ...defaultArgs, all: true }, deps);

      expect(receivedStatuses.length).toBe(1);
      expect(receivedStatuses[0].reason).toContain("PR: #789");
      expect(receivedStatuses[0].reason).toContain("New feature");
      expect(receivedStatuses[0].reason).toContain("OPEN");
    });
  });
});
