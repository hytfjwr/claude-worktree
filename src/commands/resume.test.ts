import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { makeWorktree } from "../__test-utils__.ts";
import { spawnInteractive } from "../core/spawn.ts";
import type { ResumeDeps, WorktreeInfo } from "../types/index.ts";
import { runResume } from "./resume.ts";

// Mock spawnInteractive to avoid spawning real processes in terminal mode
vi.mock("../core/spawn.ts", () => ({
  spawnInteractive: vi.fn(async () => 0),
}));

// ============================================================================
// Helper functions
// ============================================================================

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "resume-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeDeps(overrides: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    checkWeztermAvailable: async () => true,
    getGitContext: async () => ({
      repoRoot: "/repo",
      repoName: "repo",
      currentBranch: "main",
    }),
    listWorktrees: async () => ({
      worktrees: [makeWorktree({ path: "/repo", branch: "main", isMain: true }), makeWorktree({ path: tempDir })],
      mainBranch: "main",
    }),
    saveSession: vi.fn(async () => {}),
    completeSession: vi.fn(async () => {}),
    buildResumeCommand: vi.fn(() => "claude --continue"),
    createPane: vi.fn(async () => "42"),
    sendCommand: vi.fn(async () => {}),
    selectWorktree: vi.fn(async () => null),
    ...overrides,
  };
}

// Suppress console output
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// ============================================================================
// Tests
// ============================================================================

describe("runResume", () => {
  describe("terminal mode", () => {
    test("completes session when child process exits with code 0", async () => {
      vi.mocked(spawnInteractive).mockResolvedValueOnce(0);
      const deps = makeDeps();
      await runResume({ branchName: "feature/test" }, deps);

      expect(deps.completeSession).toHaveBeenCalledWith(tempDir);
    });

    test("completes session even when child process exits with non-zero code", async () => {
      vi.mocked(spawnInteractive).mockResolvedValueOnce(1);
      const deps = makeDeps();
      await runResume({ branchName: "feature/test" }, deps);

      expect(deps.saveSession).toHaveBeenCalled();
      expect(deps.completeSession).toHaveBeenCalled();
    });

    test("does not complete session when spawnInteractive throws", async () => {
      vi.mocked(spawnInteractive).mockRejectedValueOnce(new Error("spawn failed"));
      const deps = makeDeps();

      await expect(runResume({ branchName: "feature/test" }, deps)).rejects.toThrow("spawn failed");
      expect(deps.saveSession).toHaveBeenCalled();
      expect(deps.completeSession).not.toHaveBeenCalled();
    });

    test("registers signal handlers during spawnInteractive and removes them after", async () => {
      const onSpy = vi.spyOn(process, "on");
      const removeListenerSpy = vi.spyOn(process, "removeListener");

      vi.mocked(spawnInteractive).mockResolvedValueOnce(0);
      const deps = makeDeps();
      await runResume({ branchName: "feature/test" }, deps);

      expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(removeListenerSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(removeListenerSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

      onSpy.mockRestore();
      removeListenerSpy.mockRestore();
    });

    test("signal handler calls completeSession and exits on repeated signal", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const originalOn = process.on.bind(process);
      const onSpy = vi.spyOn(process, "on").mockImplementation(((
        event: string,
        handler: (...args: unknown[]) => void,
      ) => {
        if (event === "SIGINT" || event === "SIGTERM") {
          handlers[event] = handlers[event] || [];
          handlers[event].push(handler);
        }
        return originalOn(event, handler);
      }) as typeof process.on);

      vi.mocked(spawnInteractive).mockImplementation(async () => {
        // Simulate double SIGINT: first is forwarded to child, second triggers cleanup
        for (const handler of handlers.SIGINT || []) handler();
        for (const handler of handlers.SIGINT || []) handler();
        // Wait for async completeSession in the handler
        await new Promise((r) => setTimeout(r, 10));
        return 0;
      });

      const deps = makeDeps();
      await runResume({ branchName: "feature/test" }, deps);

      // completeSession is called by the signal handler AND by normal flow
      expect(deps.completeSession).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(130);

      exitSpy.mockRestore();
      onSpy.mockRestore();
    });

    test("first signal is ignored by signal handler to let spawnInteractive forward it", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const originalOn = process.on.bind(process);
      const onSpy = vi.spyOn(process, "on").mockImplementation(((
        event: string,
        handler: (...args: unknown[]) => void,
      ) => {
        if (event === "SIGINT" || event === "SIGTERM") {
          handlers[event] = handlers[event] || [];
          handlers[event].push(handler);
        }
        return originalOn(event, handler);
      }) as typeof process.on);

      vi.mocked(spawnInteractive).mockImplementation(async () => {
        // Simulate only one SIGINT (first signal)
        for (const handler of handlers.SIGINT || []) handler();
        return 0;
      });

      const deps = makeDeps();
      await runResume({ branchName: "feature/test" }, deps);

      // process.exit should NOT be called on first signal
      expect(exitSpy).not.toHaveBeenCalled();
      // completeSession is still called via normal flow after spawnInteractive resolves
      expect(deps.completeSession).toHaveBeenCalled();

      exitSpy.mockRestore();
      onSpy.mockRestore();
    });
  });

  describe("branch name specified", () => {
    test("builds resume command with correct options", async () => {
      const deps = makeDeps();
      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.buildResumeCommand).toHaveBeenCalledWith({
        prompt: undefined,
        dangerouslySkipPermissions: undefined,
      });
    });

    test("throws when branch not found", async () => {
      const deps = makeDeps();
      await expect(runResume({ branchName: "feature/nonexistent" }, deps)).rejects.toThrow(
        "Worktree not found for branch: feature/nonexistent",
      );
    });

    test("passes prompt to buildResumeCommand", async () => {
      const deps = makeDeps();
      await runResume({ branchName: "feature/test", prompt: "Continue work", pane: true }, deps);

      expect(deps.buildResumeCommand).toHaveBeenCalledWith({
        prompt: "Continue work",
        dangerouslySkipPermissions: undefined,
      });
    });

    test("passes danger flag to buildResumeCommand", async () => {
      const deps = makeDeps();
      await runResume({ branchName: "feature/test", danger: true, pane: true }, deps);

      expect(deps.buildResumeCommand).toHaveBeenCalledWith({
        prompt: undefined,
        dangerouslySkipPermissions: true,
      });
    });

    test("throws when worktree directory does not exist", async () => {
      const deps = makeDeps({
        listWorktrees: async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: "/nonexistent/path", branch: "feature/test" }),
          ],
          mainBranch: "main",
        }),
      });

      await expect(runResume({ branchName: "feature/test" }, deps)).rejects.toThrow(
        "Worktree directory does not exist: /nonexistent/path",
      );
    });
  });

  describe("interactive selection", () => {
    test("calls selectWorktree when no branch specified", async () => {
      const target = makeWorktree({ path: tempDir });
      const deps = makeDeps({
        selectWorktree: vi.fn(async () => target),
      });

      await runResume({ pane: true }, deps);

      expect(deps.selectWorktree).toHaveBeenCalled();
      expect(deps.saveSession).toHaveBeenCalled();
    });

    test("cancels when selectWorktree returns null", async () => {
      const deps = makeDeps({
        selectWorktree: vi.fn(async () => null),
      });

      await runResume({}, deps);

      expect(deps.saveSession).not.toHaveBeenCalled();
    });

    test("filters out main worktree from selection", async () => {
      const deps = makeDeps({
        selectWorktree: vi.fn(async () => null),
      });

      await runResume({}, deps);

      const passedWorktrees = (deps.selectWorktree as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorktreeInfo[];
      expect(passedWorktrees.every((w) => !w.isMain)).toBe(true);
    });
  });

  describe("no worktrees", () => {
    test("throws when no non-main worktrees exist", async () => {
      const deps = makeDeps({
        listWorktrees: async () => ({
          worktrees: [makeWorktree({ path: "/repo", branch: "main", isMain: true })],
          mainBranch: "main",
        }),
      });

      await expect(runResume({}, deps)).rejects.toThrow("No worktrees found to resume");
    });
  });

  describe("pane mode", () => {
    test("creates pane and sends command", async () => {
      const deps = makeDeps();
      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.createPane).toHaveBeenCalledWith({ keepFocus: true });
      expect(deps.sendCommand).toHaveBeenCalledWith("42", `cd "${tempDir}" && claude --continue`);
      expect(deps.saveSession).toHaveBeenCalledWith(tempDir, {
        paneId: 42,
        mode: "pane",
        startedAt: expect.any(String),
      });
    });

    test("throws when WezTerm is not available", async () => {
      const deps = makeDeps({
        checkWeztermAvailable: async () => false,
      });

      await expect(runResume({ branchName: "feature/test", pane: true }, deps)).rejects.toThrow(
        "WezTerm CLI is not installed",
      );
    });

    test("does not check WezTerm when pane is not specified", async () => {
      const deps = makeDeps({
        checkWeztermAvailable: vi.fn(async () => false),
      });

      // Use pane: true but with unavailable WezTerm to verify it's checked
      // When pane is not specified, checkWeztermAvailable should not be called
      // We test the "not pane" path by checking calls on a non-pane flow
      // that exits early (e.g. cancelled selection)
      await runResume({}, deps); // no branch, selectWorktree returns null → cancelled
      expect(deps.checkWeztermAvailable).not.toHaveBeenCalled();
    });
  });
});
