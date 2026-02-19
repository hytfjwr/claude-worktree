import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { makeWorktree } from "../__test-utils__.ts";
import { spawnInteractive } from "../core/spawn.ts";
import type { CreateArgs, CreateDeps, ProjectConfig } from "../types/index.ts";
import { checkWorktreeLimit, getSelfCommand, previewHookTemplate, readPlanFile, runCreate } from "./create.ts";

// Mock spawnInteractive to avoid spawning real processes in terminal mode
vi.mock("../core/spawn.ts", () => ({
  spawnInteractive: vi.fn(async () => 0),
}));

describe("readPlanFile", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "create-test-"));

  test("reads and trims plan file content", async () => {
    const filePath = join(tmpDir, "plan.md");
    writeFileSync(filePath, "  Hello World  \n");
    const result = await readPlanFile(filePath);
    expect(result).toBe("Hello World");
  });

  test("throws when file does not exist", async () => {
    const filePath = join(tmpDir, "nonexistent.md");
    await expect(readPlanFile(filePath)).rejects.toThrow(`Plan file not found: ${filePath}`);
  });

  test("throws when file is empty", async () => {
    const filePath = join(tmpDir, "empty.md");
    writeFileSync(filePath, "   \n  ");
    await expect(readPlanFile(filePath)).rejects.toThrow(`Plan file is empty: ${filePath}`);
  });

  test("throws with access error for permission denied", async () => {
    const filePath = join(tmpDir, "noperm.md");
    writeFileSync(filePath, "content");
    chmodSync(filePath, 0o000);
    await expect(readPlanFile(filePath)).rejects.toThrow(`Failed to read plan file ${filePath}`);
    chmodSync(filePath, 0o644); // restore for cleanup
  });

  test("throws when file exceeds 1MB", async () => {
    const filePath = join(tmpDir, "large.md");
    // Create a file slightly over 1MB
    writeFileSync(filePath, "x".repeat(1024 * 1024 + 1));
    await expect(readPlanFile(filePath)).rejects.toThrow("too large");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("getSelfCommand", () => {
  const origArgv = [...process.argv];

  afterEach(() => {
    process.argv[0] = origArgv[0];
    process.argv[1] = origArgv[1];
  });

  test("returns quoted argv[0] and resolved argv[1]", () => {
    process.argv[0] = "/usr/local/bin/node";
    process.argv[1] = "bin/claude-worktree.ts";
    const result = getSelfCommand();
    expect(result).toBe(`"/usr/local/bin/node" "${resolve("bin/claude-worktree.ts")}"`);
  });

  test("handles paths with spaces", () => {
    process.argv[0] = "/usr/local/bin/my node";
    process.argv[1] = "/path with spaces/script.ts";
    const result = getSelfCommand();
    expect(result).toBe(`"/usr/local/bin/my node" "${resolve("/path with spaces/script.ts")}"`);
  });
});

describe("previewHookTemplate", () => {
  test("replaces path and slot placeholders", () => {
    const result = previewHookTemplate("cd {path} && start -p {slot}", { path: "/repo/.worktrees/feat-x", slot: "3" });
    expect(result).toBe("cd /repo/.worktrees/feat-x && start -p 3");
  });

  test("returns template unchanged when no matching placeholders", () => {
    const result = previewHookTemplate("echo hello", { path: "/repo", slot: "1" });
    expect(result).toBe("echo hello");
  });

  test("handles template with only path placeholder", () => {
    const result = previewHookTemplate("cd {path}", { path: "/repo/.worktrees/feat-x", slot: "<auto>" });
    expect(result).toBe("cd /repo/.worktrees/feat-x");
  });
});

describe("checkWorktreeLimit", () => {
  test("returns null when config is null", () => {
    expect(checkWorktreeLimit(null, 3, false)).toBeNull();
  });

  test("returns null when maxWorktrees is undefined", () => {
    const config: ProjectConfig = {};
    expect(checkWorktreeLimit(config, 3, false)).toBeNull();
  });

  test("returns null when count is below limit", () => {
    const config: ProjectConfig = { maxWorktrees: 5 };
    expect(checkWorktreeLimit(config, 3, false)).toBeNull();
  });

  test("returns error message when count is at limit", () => {
    const config: ProjectConfig = { maxWorktrees: 5 };
    const result = checkWorktreeLimit(config, 5, false);
    expect(result).toContain("Worktree limit reached (5/5)");
    expect(result).toContain("claude-worktree clean");
  });

  test("returns error message when count exceeds limit", () => {
    const config: ProjectConfig = { maxWorktrees: 3 };
    const result = checkWorktreeLimit(config, 4, false);
    expect(result).toContain("Worktree limit reached (4/3)");
  });

  test("returns null when at limit but replacing existing worktree", () => {
    const config: ProjectConfig = { maxWorktrees: 5 };
    expect(checkWorktreeLimit(config, 5, true)).toBeNull();
  });

  test("returns error when exceeding limit even with replace", () => {
    const config: ProjectConfig = { maxWorktrees: 3 };
    const result = checkWorktreeLimit(config, 5, true);
    expect(result).toContain("Worktree limit reached (4/3)");
  });

  test("maxWorktrees: 0 blocks all worktree creation", () => {
    const config: ProjectConfig = { maxWorktrees: 0 };
    const result = checkWorktreeLimit(config, 0, false);
    expect(result).toContain("Worktree limit reached (0/0)");
  });

  test("returns error for negative maxWorktrees", () => {
    const config: ProjectConfig = { maxWorktrees: -1 };
    const result = checkWorktreeLimit(config, 0, false);
    expect(result).toContain("Invalid maxWorktrees value: -1");
  });

  test("returns error for non-integer maxWorktrees", () => {
    const config: ProjectConfig = { maxWorktrees: 2.5 };
    const result = checkWorktreeLimit(config, 0, false);
    expect(result).toContain("Invalid maxWorktrees value: 2.5");
  });
});

// =============================================================================
// runCreate orchestration tests
// =============================================================================

function makeDeps(overrides: Partial<CreateDeps> = {}): CreateDeps {
  return {
    checkWeztermAvailable: vi.fn(async () => true),
    getGitContext: vi.fn(async () => ({
      repoRoot: "/repo",
      repoName: "repo",
      currentBranch: "main",
    })),
    getWorktreePath: vi.fn(
      (_root: string, _name: string, branch: string) => `/repo/.worktrees/${branch.replace("/", "-")}`,
    ),
    loadProjectConfig: vi.fn(async () => null),
    listWorktrees: vi.fn(async () => ({
      worktrees: [makeWorktree({ path: "/repo", branch: "main", isMain: true })],
      mainBranch: "main",
    })),
    branchExists: vi.fn(async () => false),
    verifyBranchRef: vi.fn(async () => true),
    fetchOrigin: vi.fn(async () => {}),
    createWorktree: vi.fn(async () => {}),
    removeWorktree: vi.fn(async () => {}),
    deleteLocalBranch: vi.fn(async () => {}),
    buildHookCommand: vi.fn((template: string, vars: { path: string; slot?: number }) =>
      template.replace("{path}", vars.path).replace("{slot}", String(vars.slot ?? "")),
    ),
    resolveHookTimeout: vi.fn(() => 600),
    executeHookWithSpinner: vi.fn(async () => ({ success: true as const })),
    assignSlot: vi.fn(async () => 1),
    readSlot: vi.fn(async () => undefined),
    deleteSlot: vi.fn(async () => {}),
    saveSession: vi.fn(async () => {}),
    completeSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    buildClaudeCommand: vi.fn(() => "claude --prompt 'test'"),
    createPane: vi.fn(async () => "42"),
    sendCommand: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    startSpinner: vi.fn(() => ({ stop: vi.fn(), fail: vi.fn(), updateTail: vi.fn(), isExpanded: vi.fn(() => false) })),
    performRollback: vi.fn(async () => {}),
    ...overrides,
  };
}

const defaultPaneArgs: CreateArgs = {
  branchName: "feat/x",
  prompt: "do something",
  pane: true,
};

const defaultTerminalArgs: CreateArgs = {
  branchName: "feat/x",
  prompt: "do something",
};

describe("runCreate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(spawnInteractive).mockClear();
    process.exitCode = undefined;
  });

  // ---------------------------------------------------------------------------
  // Pane mode basic flow
  // ---------------------------------------------------------------------------

  describe("pane mode basic flow", () => {
    test("creates worktree and launches Claude in pane", async () => {
      const deps = makeDeps();
      await runCreate(defaultPaneArgs, deps);

      expect(deps.getGitContext).toHaveBeenCalled();
      expect(deps.getWorktreePath).toHaveBeenCalledWith("/repo", "repo", "feat/x");
      expect(deps.loadProjectConfig).toHaveBeenCalledWith("/repo");
      expect(deps.listWorktrees).toHaveBeenCalled();
      expect(deps.createWorktree).toHaveBeenCalledWith("feat/x", "/repo/.worktrees/feat-x", "main");
      expect(deps.buildClaudeCommand).toHaveBeenCalled();
      expect(deps.createPane).toHaveBeenCalledWith({ keepFocus: true });
      expect(deps.sendCommand).toHaveBeenCalledWith("42", expect.stringContaining("_run-in-pane"));
      expect(deps.saveSession).toHaveBeenCalledWith("/repo/.worktrees/feat-x", {
        paneId: 42,
        mode: "pane",
        startedAt: expect.any(String),
      });
    });

    test("does not call spawnInteractive in pane mode", async () => {
      const deps = makeDeps();
      await runCreate(defaultPaneArgs, deps);

      expect(spawnInteractive).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Terminal mode basic flow
  // ---------------------------------------------------------------------------

  describe("terminal mode basic flow", () => {
    test("creates worktree and launches Claude in terminal", async () => {
      const deps = makeDeps();
      await runCreate(defaultTerminalArgs, deps);

      expect(deps.createWorktree).toHaveBeenCalledWith("feat/x", "/repo/.worktrees/feat-x", "main");
      expect(deps.buildClaudeCommand).toHaveBeenCalled();
      expect(deps.saveSession).toHaveBeenCalledWith("/repo/.worktrees/feat-x", {
        mode: "terminal",
        startedAt: expect.any(String),
      });
      expect(spawnInteractive).toHaveBeenCalledWith({
        command: "claude --prompt 'test'",
        cwd: "/repo/.worktrees/feat-x",
      });
      expect(deps.completeSession).toHaveBeenCalledWith("/repo/.worktrees/feat-x");
    });

    test("does not complete session when spawnInteractive throws", async () => {
      vi.mocked(spawnInteractive).mockRejectedValueOnce(new Error("process crashed"));
      const deps = makeDeps();

      await expect(runCreate(defaultTerminalArgs, deps)).rejects.toThrow("process crashed");
      expect(deps.saveSession).toHaveBeenCalled();
      expect(deps.completeSession).not.toHaveBeenCalled();
    });

    test("completes session even when child process exits with non-zero code", async () => {
      vi.mocked(spawnInteractive).mockResolvedValueOnce(1);
      const deps = makeDeps();

      await runCreate(defaultTerminalArgs, deps);
      expect(deps.saveSession).toHaveBeenCalled();
      expect(deps.completeSession).toHaveBeenCalled();
    });

    test("does not create pane in terminal mode", async () => {
      const deps = makeDeps();
      await runCreate(defaultTerminalArgs, deps);

      expect(deps.createPane).not.toHaveBeenCalled();
      expect(deps.sendCommand).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // WezTerm availability
  // ---------------------------------------------------------------------------

  describe("wezterm availability", () => {
    test("throws when wezterm is unavailable in pane mode", async () => {
      const deps = makeDeps({
        checkWeztermAvailable: vi.fn(async () => false),
      });

      await expect(runCreate(defaultPaneArgs, deps)).rejects.toThrow("WezTerm CLI is not installed");
    });

    test("does not check wezterm in terminal mode", async () => {
      const deps = makeDeps({
        checkWeztermAvailable: vi.fn(async () => false),
      });

      await runCreate(defaultTerminalArgs, deps);

      expect(deps.checkWeztermAvailable).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Base branch
  // ---------------------------------------------------------------------------

  describe("base branch", () => {
    test("uses current branch as default base", async () => {
      const deps = makeDeps();
      await runCreate(defaultPaneArgs, deps);

      expect(deps.createWorktree).toHaveBeenCalledWith("feat/x", expect.any(String), "main");
    });

    test("uses specified base branch", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, baseBranch: "develop" }, deps);

      expect(deps.verifyBranchRef).toHaveBeenCalledWith("develop");
      expect(deps.createWorktree).toHaveBeenCalledWith("feat/x", expect.any(String), "develop");
    });

    test("throws when explicit base branch not found", async () => {
      const deps = makeDeps({
        verifyBranchRef: vi.fn(async () => false),
      });

      await expect(runCreate({ ...defaultPaneArgs, baseBranch: "nonexistent" }, deps)).rejects.toThrow(
        'Base branch not found: "nonexistent"',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Pull mode
  // ---------------------------------------------------------------------------

  describe("pull mode", () => {
    test("fetches origin and uses remote ref", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, pull: true }, deps);

      expect(deps.fetchOrigin).toHaveBeenCalledWith("main");
      expect(deps.verifyBranchRef).toHaveBeenCalledWith("origin/main");
      expect(deps.createWorktree).toHaveBeenCalledWith("feat/x", expect.any(String), "origin/main");
    });

    test("falls back to local when remote ref not found", async () => {
      const deps = makeDeps({
        verifyBranchRef: vi.fn(async (ref: string) => !ref.startsWith("origin/")),
      });
      await runCreate({ ...defaultPaneArgs, pull: true }, deps);

      expect(deps.createWorktree).toHaveBeenCalledWith("feat/x", expect.any(String), "main");
    });

    test("skips network call in dry-run mode", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, pull: true, dryRun: true }, deps);

      expect(deps.fetchOrigin).not.toHaveBeenCalled();
      expect(deps.createWorktree).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Existing worktree handling
  // ---------------------------------------------------------------------------

  describe("existing worktree handling", () => {
    const existingWorktree = makeWorktree({
      path: "/repo/.worktrees/feat-x",
      branch: "feat/x",
    });

    function depsWithExisting(overrides: Partial<CreateDeps> = {}) {
      return makeDeps({
        listWorktrees: vi.fn(async () => ({
          worktrees: [makeWorktree({ path: "/repo", branch: "main", isMain: true }), existingWorktree],
          mainBranch: "main",
        })),
        ...overrides,
      });
    }

    test("replaces when user confirms", async () => {
      const deps = depsWithExisting();
      await runCreate(defaultPaneArgs, deps);

      expect(deps.confirm).toHaveBeenCalled();
      expect(deps.removeWorktree).toHaveBeenCalledWith(existingWorktree.path, false);
      expect(deps.deleteLocalBranch).toHaveBeenCalledWith("feat/x", true);
      expect(deps.deleteSlot).toHaveBeenCalledWith(existingWorktree.path);
      expect(deps.deleteSession).toHaveBeenCalledWith(existingWorktree.path);
      expect(deps.createWorktree).toHaveBeenCalled();
    });

    test("cancels when user declines", async () => {
      const deps = depsWithExisting({
        confirm: vi.fn(async () => false),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.removeWorktree).not.toHaveBeenCalled();
      expect(deps.createWorktree).not.toHaveBeenCalled();
    });

    test("passes force flag when worktree is dirty", async () => {
      const dirtyWorktree = makeWorktree({
        path: "/repo/.worktrees/feat-x",
        branch: "feat/x",
        isDirty: true,
      });
      const deps = makeDeps({
        listWorktrees: vi.fn(async () => ({
          worktrees: [makeWorktree({ path: "/repo", branch: "main", isMain: true }), dirtyWorktree],
          mainBranch: "main",
        })),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.removeWorktree).toHaveBeenCalledWith(dirtyWorktree.path, true);
    });

    test("runs preClean and postClean hooks during replacement", async () => {
      const config: ProjectConfig = {
        preClean: "cd {path} && docker-compose down",
        postClean: "echo done",
      };
      const deps = depsWithExisting({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.executeHookWithSpinner).toHaveBeenCalledWith(expect.objectContaining({ label: "preClean" }));
      expect(deps.executeHookWithSpinner).toHaveBeenCalledWith(expect.objectContaining({ label: "postClean" }));
    });

    test("continues when preClean hook fails during replacement", async () => {
      const config: ProjectConfig = { preClean: "exit 1" };
      const deps = depsWithExisting({
        loadProjectConfig: vi.fn(async () => config),
        executeHookWithSpinner: vi.fn(async () => ({
          success: false as const,
          message: "hook failed",
        })),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.removeWorktree).toHaveBeenCalled();
      expect(deps.createWorktree).toHaveBeenCalled();
    });

    test("does not check branchExists when worktree already exists", async () => {
      const deps = depsWithExisting();
      await runCreate(defaultPaneArgs, deps);

      expect(deps.branchExists).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Existing branch handling (no worktree)
  // ---------------------------------------------------------------------------

  describe("existing branch handling (no worktree)", () => {
    test("deletes branch when user confirms", async () => {
      const deps = makeDeps({
        branchExists: vi.fn(async () => true),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.confirm).toHaveBeenCalled();
      expect(deps.deleteLocalBranch).toHaveBeenCalledWith("feat/x", true);
      expect(deps.createWorktree).toHaveBeenCalled();
    });

    test("cancels when user declines", async () => {
      const deps = makeDeps({
        branchExists: vi.fn(async () => true),
        confirm: vi.fn(async () => false),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.createWorktree).not.toHaveBeenCalled();
    });

    test("stops when branch deletion fails", async () => {
      const deps = makeDeps({
        branchExists: vi.fn(async () => true),
        deleteLocalBranch: vi.fn(async () => {
          throw new Error("branch delete failed");
        }),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.createWorktree).not.toHaveBeenCalled();
    });

    test("skips when no existing branch", async () => {
      const deps = makeDeps({
        branchExists: vi.fn(async () => false),
      });
      await runCreate(defaultPaneArgs, deps);

      // confirm should not be called for branch handling
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(deps.createWorktree).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Path collision detection
  // ---------------------------------------------------------------------------

  describe("path collision detection", () => {
    test("throws when different branch maps to same path as existing worktree", async () => {
      const deps = makeDeps({
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/feature-auth", branch: "feature/auth" }),
          ],
          mainBranch: "main",
        })),
        getWorktreePath: vi.fn(() => "/repo/.worktrees/feature-auth"),
      });

      await expect(runCreate({ branchName: "feature-auth", prompt: "test", pane: true }, deps)).rejects.toThrow(
        "Path collision",
      );
    });

    test("includes clean command as copy-pasteable command in error message", async () => {
      const deps = makeDeps({
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/feature-auth", branch: "feature/auth" }),
          ],
          mainBranch: "main",
        })),
        getWorktreePath: vi.fn(() => "/repo/.worktrees/feature-auth"),
      });

      await expect(runCreate({ branchName: "feature-auth", prompt: "test", pane: true }, deps)).rejects.toThrow(
        "claude-worktree clean feature/auth",
      );
    });

    test("does not throw for same branch (handled by existing worktree flow)", async () => {
      const deps = makeDeps({
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/feat-x", branch: "feat/x" }),
          ],
          mainBranch: "main",
        })),
      });

      await runCreate(defaultPaneArgs, deps);
      expect(deps.createWorktree).toHaveBeenCalled();
    });

    test("does not throw when no path collision exists", async () => {
      const deps = makeDeps();
      await runCreate(defaultPaneArgs, deps);

      expect(deps.createWorktree).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Worktree limit
  // ---------------------------------------------------------------------------

  describe("worktree limit", () => {
    test("blocks creation when limit reached", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({ maxWorktrees: 2 })),
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/a", branch: "a" }),
            makeWorktree({ path: "/repo/.worktrees/b", branch: "b" }),
          ],
          mainBranch: "main",
        })),
      });
      await expect(runCreate(defaultPaneArgs, deps)).rejects.toThrow("Worktree limit reached");
      expect(deps.createWorktree).not.toHaveBeenCalled();
    });

    test("allows creation when replacing within limit", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({ maxWorktrees: 2 })),
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/feat-x", branch: "feat/x" }),
            makeWorktree({ path: "/repo/.worktrees/b", branch: "b" }),
          ],
          mainBranch: "main",
        })),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(process.exitCode).toBeUndefined();
      expect(deps.createWorktree).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Hooks and slots
  // ---------------------------------------------------------------------------

  describe("hooks and slots", () => {
    test("allocates slot when hooks use {slot}", async () => {
      const config: ProjectConfig = {
        postCreate: "cd {path} && start -p {slot}",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.assignSlot).toHaveBeenCalledWith("/repo/.worktrees/feat-x");
    });

    test("does not allocate slot when no hooks use {slot}", async () => {
      const config: ProjectConfig = {
        postCreate: "cd {path} && start",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.assignSlot).not.toHaveBeenCalled();
    });

    test("does not allocate slot when no config", async () => {
      const deps = makeDeps();
      await runCreate(defaultPaneArgs, deps);

      expect(deps.assignSlot).not.toHaveBeenCalled();
    });

    test("runs postCreate hook in terminal mode", async () => {
      const config: ProjectConfig = {
        postCreate: "cd {path} && setup",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate(defaultTerminalArgs, deps);

      expect(deps.executeHookWithSpinner).toHaveBeenCalledWith(expect.objectContaining({ label: "postCreate" }));
      expect(spawnInteractive).toHaveBeenCalled();
    });

    test("rolls back on postCreate hook failure in terminal mode", async () => {
      const config: ProjectConfig = {
        postCreate: "cd {path} && setup",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
        executeHookWithSpinner: vi.fn(async () => ({
          success: false as const,
          message: "setup failed",
        })),
      });
      await runCreate(defaultTerminalArgs, deps);

      expect(deps.performRollback).toHaveBeenCalled();
      expect(spawnInteractive).not.toHaveBeenCalled();
    });

    test("does not execute postCreate hook in pane mode (delegated to pane process)", async () => {
      const config: ProjectConfig = {
        postCreate: "cd {path} && setup",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate(defaultPaneArgs, deps);

      // In pane mode, postCreate is packed into the payload — not executed by runCreate
      expect(deps.executeHookWithSpinner).not.toHaveBeenCalled();
      expect(deps.createPane).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Dry-run mode
  // ---------------------------------------------------------------------------

  describe("dry-run mode", () => {
    test("shows preview without side effects", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      expect(deps.createWorktree).not.toHaveBeenCalled();
      expect(deps.createPane).not.toHaveBeenCalled();
      expect(deps.saveSession).not.toHaveBeenCalled();
    });

    test("outputs structured numbered steps", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      const logs = vi.mocked(console.log).mock.calls.map((c) => c[0]);
      expect(logs).toContainEqual(expect.stringContaining("Dry Run Preview:"));
      expect(logs).toContainEqual(expect.stringContaining("1. Create worktree:"));
      expect(logs).toContainEqual(expect.stringContaining("2. Launch mode:"));
      expect(logs).toContainEqual(expect.stringContaining("WezTerm pane"));
      expect(logs).toContainEqual(expect.stringContaining("3. Claude command:"));
    });

    test("includes fetch step when pull is enabled", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, pull: true, dryRun: true }, deps);

      const logs = vi.mocked(console.log).mock.calls.map((c) => c[0]);
      expect(logs).toContainEqual(expect.stringContaining("1. Fetch remote:"));
      expect(logs).toContainEqual(expect.stringContaining("git fetch origin main"));
      expect(logs).toContainEqual(expect.stringContaining("2. Create worktree:"));
    });

    test("includes replace step when existing worktree found", async () => {
      const deps = makeDeps({
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/feat-x", branch: "feat/x" }),
          ],
          mainBranch: "main",
        })),
      });
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      const logs = vi.mocked(console.log).mock.calls.map((c) => c[0]);
      expect(logs).toContainEqual(expect.stringContaining("1. Replace worktree:"));
      expect(logs).toContainEqual(expect.stringContaining("delete and recreate"));
      expect(logs).toContainEqual(expect.stringContaining("2. Create worktree:"));
    });

    test("includes post-create hook step when configured", async () => {
      const config: ProjectConfig = {
        postCreate: "cd {path} && docker-compose up -d",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      const logs = vi.mocked(console.log).mock.calls.map((c) => c[0]);
      expect(logs).toContainEqual(expect.stringContaining("Post-create hook:"));
      expect(logs).toContainEqual(expect.stringContaining("docker-compose up -d"));
    });

    test("shows current terminal for non-pane mode", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultTerminalArgs, dryRun: true }, deps);

      const logs = vi.mocked(console.log).mock.calls.map((c) => c[0]);
      expect(logs).toContainEqual(expect.stringContaining("Current terminal"));
    });

    test("does not prompt user for existing worktree in dry-run", async () => {
      const deps = makeDeps({
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/feat-x", branch: "feat/x" }),
          ],
          mainBranch: "main",
        })),
      });
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      expect(deps.confirm).not.toHaveBeenCalled();
      expect(deps.createWorktree).not.toHaveBeenCalled();
    });

    test("does not execute hooks in dry-run", async () => {
      const config: ProjectConfig = {
        postCreate: "cd {path} && docker-compose up -d",
        preClean: "cd {path} && docker-compose down",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      expect(deps.executeHookWithSpinner).not.toHaveBeenCalled();
    });

    test("calls buildClaudeCommand to preview the command", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalled();
    });

    test("includes pre/post-clean hooks when replacing existing worktree", async () => {
      const config: ProjectConfig = {
        preClean: "cd {path} && docker-compose down",
        postClean: "cd {path} && docker system prune -f",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
        listWorktrees: vi.fn(async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/repo/.worktrees/feat-x", branch: "feat/x" }),
          ],
          mainBranch: "main",
        })),
      });
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      const preCleanIdx = logs.findIndex((l) => l.includes("Pre-clean hook:"));
      const replaceIdx = logs.findIndex((l) => l.includes("Replace worktree:"));
      const postCleanIdx = logs.findIndex((l) => l.includes("Post-clean hook:"));

      expect(preCleanIdx).toBeGreaterThanOrEqual(0);
      expect(replaceIdx).toBeGreaterThanOrEqual(0);
      expect(postCleanIdx).toBeGreaterThanOrEqual(0);
      expect(preCleanIdx).toBeLessThan(replaceIdx);
      expect(replaceIdx).toBeLessThan(postCleanIdx);
      expect(logs[preCleanIdx]).toContain("docker-compose down");
      expect(logs[postCleanIdx]).toContain("docker system prune -f");
    });

    test("omits pre/post-clean hooks when no existing worktree", async () => {
      const config: ProjectConfig = {
        preClean: "cd {path} && docker-compose down",
        postClean: "cd {path} && docker system prune -f",
      };
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => config),
      });
      await runCreate({ ...defaultPaneArgs, dryRun: true }, deps);

      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes("Pre-clean hook:"))).toBe(false);
      expect(logs.some((l) => l.includes("Post-clean hook:"))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Plan file
  // ---------------------------------------------------------------------------

  describe("plan file", () => {
    const orchTmpDir = mkdtempSync(join(tmpdir(), "create-orch-test-"));

    afterAll(() => {
      rmSync(orchTmpDir, { recursive: true, force: true });
    });

    test("reads prompt from plan file", async () => {
      const planPath = join(orchTmpDir, "plan.md");
      writeFileSync(planPath, "Implement authentication feature");

      const deps = makeDeps();
      await runCreate({ branchName: "feat/x", prompt: "", planFile: planPath, pane: true }, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Implement authentication feature",
        }),
      );
    });

    test("throws when plan file not found", async () => {
      const deps = makeDeps();
      await expect(
        runCreate({ branchName: "feat/x", prompt: "", planFile: "/nonexistent.md", pane: true }, deps),
      ).rejects.toThrow("Plan file not found");
    });
  });

  // ---------------------------------------------------------------------------
  // Merge and draft options
  // ---------------------------------------------------------------------------

  describe("merge and draft options", () => {
    test("passes merge instructions to buildClaudeCommand", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, merge: true }, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          mergeInstructions: {
            baseBranch: "main",
            worktreePath: "/repo/.worktrees/feat-x",
          },
        }),
      );
    });

    test("passes draft instructions to buildClaudeCommand", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, draft: true }, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          draftInstructions: {
            baseBranch: "main",
            branchName: "feat/x",
          },
        }),
      );
    });

    test("passes pr instructions to buildClaudeCommand", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, pr: true }, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          prInstructions: {
            baseBranch: "main",
            branchName: "feat/x",
          },
        }),
      );
    });

    test("passes pr instructions with explicit base branch", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, pr: true, baseBranch: "develop" }, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          prInstructions: {
            baseBranch: "develop",
            branchName: "feat/x",
          },
        }),
      );
    });

    test("passes danger flag to buildClaudeCommand", async () => {
      const deps = makeDeps();
      await runCreate({ ...defaultPaneArgs, danger: true }, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          dangerouslySkipPermissions: true,
        }),
      );
    });

    test("passes permissionMode from config to buildClaudeCommand", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({ permissionMode: "full-auto" as const })),
      });
      await runCreate(defaultPaneArgs, deps);

      expect(deps.buildClaudeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionMode: "full-auto",
        }),
      );
    });

    test("does not set permissionMode when config has no permissionMode", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({})),
      });
      await runCreate(defaultPaneArgs, deps);

      const callArgs = vi.mocked(deps.buildClaudeCommand).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("permissionMode");
    });
  });

  // ---------------------------------------------------------------------------
  // Pane mode error handling
  // ---------------------------------------------------------------------------

  describe("pane mode error handling", () => {
    test("rolls back when pane creation fails", async () => {
      const deps = makeDeps({
        createPane: vi.fn(async () => {
          throw new Error("pane creation failed");
        }),
      });

      await expect(runCreate(defaultPaneArgs, deps)).rejects.toThrow("pane creation failed");
      expect(deps.performRollback).toHaveBeenCalled();
    });

    test("rolls back when sendCommand fails", async () => {
      const deps = makeDeps({
        sendCommand: vi.fn(async () => {
          throw new Error("send failed");
        }),
      });

      await expect(runCreate(defaultPaneArgs, deps)).rejects.toThrow("send failed");
      expect(deps.performRollback).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Signal handling during creation phase
  // ---------------------------------------------------------------------------

  describe("signal handling during creation phase", () => {
    beforeEach(() => {
      vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    });

    afterEach(() => {
      vi.mocked(process.exit).mockRestore();
    });

    test("triggers rollback on SIGINT after worktree creation", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({
          postCreate: "cd {path} && start -p {slot}",
        })),
        assignSlot: vi.fn(async () => {
          // Simulate SIGINT during slot assignment (after worktree creation)
          process.emit("SIGINT");
          return 1;
        }),
      });

      await runCreate(defaultTerminalArgs, deps);
      // Allow async signal handler to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(deps.performRollback).toHaveBeenCalledWith(
        expect.objectContaining({
          worktreePath: "/repo/.worktrees/feat-x",
          repoRoot: "/repo",
        }),
      );
      expect(process.exit).toHaveBeenCalledWith(130);
    });

    test("does not trigger signal-based rollback during Claude launch", async () => {
      // SIGINT during spawnInteractive should NOT trigger our handler
      // (it has been removed before launch)
      vi.mocked(spawnInteractive).mockImplementation(async () => {
        process.emit("SIGINT");
        return 0;
      });

      const deps = makeDeps();
      await runCreate(defaultTerminalArgs, deps);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(deps.performRollback).not.toHaveBeenCalled();
    });

    test("does not leave stale signal listeners after normal completion", async () => {
      const sigintBefore = process.listenerCount("SIGINT");
      const sigtermBefore = process.listenerCount("SIGTERM");

      const deps = makeDeps();
      await runCreate(defaultTerminalArgs, deps);

      expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    });

    test("triggers rollback on SIGTERM with correct exit code", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({
          postCreate: "cd {path} && start -p {slot}",
        })),
        assignSlot: vi.fn(async () => {
          process.emit("SIGTERM");
          return 1;
        }),
      });

      await runCreate(defaultTerminalArgs, deps);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(deps.performRollback).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(143); // 128 + SIGTERM(15)
    });

    test("triggers rollback on SIGINT in pane mode", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({
          postCreate: "cd {path} && start -p {slot}",
        })),
        assignSlot: vi.fn(async () => {
          process.emit("SIGINT");
          return 1;
        }),
      });

      await runCreate(defaultPaneArgs, deps);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(deps.performRollback).toHaveBeenCalledWith(
        expect.objectContaining({
          worktreePath: "/repo/.worktrees/feat-x",
          repoRoot: "/repo",
        }),
      );
      expect(process.exit).toHaveBeenCalledWith(130);
    });

    test("cleans up signal handlers when error occurs during creation phase", async () => {
      const sigintBefore = process.listenerCount("SIGINT");
      const sigtermBefore = process.listenerCount("SIGTERM");

      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({
          postCreate: "cd {path} && start -p {slot}",
        })),
        assignSlot: vi.fn(async () => {
          throw new Error("slot assignment failed");
        }),
      });

      await expect(runCreate(defaultTerminalArgs, deps)).rejects.toThrow("slot assignment failed");

      expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    });
  });
});
