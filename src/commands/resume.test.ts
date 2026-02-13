import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import type { ResumeDeps, WorktreeInfo } from "../types/index.ts";
import { runResume } from "./resume.ts";

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

function makeWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: tempDir,
    branch: "feature/test",
    isLocked: false,
    isDirty: false,
    isMain: false,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    checkWeztermAvailable: async () => true,
    getGitContext: async () => ({
      repoRoot: "/repo",
      repoName: "repo",
      currentBranch: "main",
    }),
    listWorktrees: async () => ({
      worktrees: [makeWorktree({ path: "/repo", branch: "main", isMain: true }), makeWorktree()],
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
  // Note: Terminal mode tests use pane mode to avoid spawning real processes.
  // Terminal mode launch logic is equivalent to create.ts (same signal forwarding pattern).

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
      const target = makeWorktree();
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
