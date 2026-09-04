import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { makeWorktree } from "../__test-utils__.ts";
import { DependencyError } from "../core/errors.ts";
import { determineSessionStatus } from "../core/session.ts";
import { spawnInteractive } from "../core/spawn.ts";
import type { ResumeDeps, SessionInfo, WorktreeInfo } from "../types/index.ts";
import { buildPaneResumeCommand, runResume } from "./resume.ts";

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
    ensurePaneBackend: vi.fn(async () => ({
      name: "wezterm" as const,
      createPane: vi.fn(async () => ({ paneId: "42" })),
      sendCommand: vi.fn(async () => {}),
      closePane: vi.fn(async () => {}),
    })),
    getGitContext: async () => ({
      repoRoot: "/repo",
      repoName: "repo",
      currentBranch: "main",
    }),
    loadProjectConfig: vi.fn(async () => null),
    listWorktrees: async () => ({
      worktrees: [makeWorktree({ path: "/repo", branch: "main", isMain: true }), makeWorktree({ path: tempDir })],
      mainBranch: "main",
    }),
    saveSession: vi.fn(async () => {}),
    completeSession: vi.fn(async () => {}),
    readSession: vi.fn(async () => undefined),
    determineSessionStatus,
    listWeztermPanes: vi.fn(async () => null),
    listTmuxPanes: vi.fn(async () => null),
    listHerdrPanes: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    buildResumeCommand: vi.fn(() => "claude --continue"),
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

    test("completes session even when spawnInteractive throws", async () => {
      vi.mocked(spawnInteractive).mockRejectedValueOnce(new Error("spawn failed"));
      const deps = makeDeps();

      await expect(runResume({ branchName: "feature/test" }, deps)).rejects.toThrow("spawn failed");
      expect(deps.saveSession).toHaveBeenCalled();
      expect(deps.completeSession).toHaveBeenCalledOnce();
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

    test("reports a completeSession failure instead of swallowing it", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({
        completeSession: vi.fn(async () => {
          throw new Error("cache write failed");
        }),
      });

      await runResume({ branchName: "feature/test" }, deps);

      const warned = warnSpy.mock.calls.flat().join("\n");
      expect(warned).toContain("Failed to mark the session as completed");
      expect(warned).toContain("cache write failed");
      warnSpy.mockRestore();
    });

    test("a completeSession failure does not fail the resume", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({
        completeSession: vi.fn(async () => {
          throw new Error("cache write failed");
        }),
      });

      await expect(runResume({ branchName: "feature/test" }, deps)).resolves.toBeUndefined();
    });
  });

  describe("branch name specified", () => {
    test("throws when branch not found", async () => {
      const deps = makeDeps();
      await expect(runResume({ branchName: "feature/nonexistent" }, deps)).rejects.toThrow(
        "Worktree not found for branch: feature/nonexistent",
      );
    });

    test("suggests a similar branch when not found", async () => {
      const deps = makeDeps();
      await expect(runResume({ branchName: "feature/tset" }, deps)).rejects.toThrow('Did you mean "feature/test"?');
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

  describe("active session detection", () => {
    const runningSession: SessionInfo = {
      mode: "pane",
      paneId: 99,
      backendType: "wezterm",
      startedAt: new Date().toISOString(),
    };

    const doneSession: SessionInfo = {
      mode: "terminal",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    test("warns and cancels when active session exists and user declines", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({
        readSession: vi.fn(async () => runningSession),
        listWeztermPanes: vi.fn(async () => [{ paneId: 99, title: "claude", cwd: "/tmp" }]),
        confirm: vi.fn(async () => false),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(warnSpy).toHaveBeenCalled();
      expect(deps.confirm).toHaveBeenCalledWith("Continue anyway?");
      expect(deps.saveSession).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test("proceeds when active session exists and user confirms", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({
        readSession: vi.fn(async () => runningSession),
        listWeztermPanes: vi.fn(async () => [{ paneId: 99, title: "claude", cwd: "/tmp" }]),
        confirm: vi.fn(async () => true),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(warnSpy).toHaveBeenCalled();
      expect(deps.confirm).toHaveBeenCalled();
      expect(deps.saveSession).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test("does not warn when existing session is done", async () => {
      const deps = makeDeps({
        readSession: vi.fn(async () => doneSession),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.confirm).not.toHaveBeenCalled();
      expect(deps.saveSession).toHaveBeenCalled();
    });

    test("does not warn when no existing session", async () => {
      const deps = makeDeps({
        readSession: vi.fn(async () => undefined),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.confirm).not.toHaveBeenCalled();
      expect(deps.saveSession).toHaveBeenCalled();
    });

    test("warns for running terminal session (no completedAt)", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const terminalSession: SessionInfo = {
        mode: "terminal",
        startedAt: new Date().toISOString(),
      };
      const deps = makeDeps({
        readSession: vi.fn(async () => terminalSession),
        confirm: vi.fn(async () => false),
      });

      await runResume({ branchName: "feature/test" }, deps);

      expect(deps.confirm).toHaveBeenCalled();
      expect(deps.saveSession).not.toHaveBeenCalled();
    });

    test("skips pane listing for terminal-mode sessions", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const terminalSession: SessionInfo = {
        mode: "terminal",
        startedAt: new Date().toISOString(),
      };
      const deps = makeDeps({
        readSession: vi.fn(async () => terminalSession),
        confirm: vi.fn(async () => true),
      });

      await runResume({ branchName: "feature/test" }, deps);

      expect(deps.listWeztermPanes).not.toHaveBeenCalled();
      expect(deps.listTmuxPanes).not.toHaveBeenCalled();
    });

    test("only queries matching backend for pane-mode sessions", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const tmuxSession: SessionInfo = {
        mode: "pane",
        paneId: "%5",
        backendType: "tmux",
        startedAt: new Date().toISOString(),
      };
      const deps = makeDeps({
        readSession: vi.fn(async () => tmuxSession),
        listTmuxPanes: vi.fn(async () => [{ paneId: "%5", title: "claude", cwd: "/tmp" }]),
        confirm: vi.fn(async () => true),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.listTmuxPanes).toHaveBeenCalled();
      expect(deps.listWeztermPanes).not.toHaveBeenCalled();
    });

    test("only queries herdr backend for herdr pane-mode sessions", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const herdrSession: SessionInfo = {
        mode: "pane",
        paneId: "w1B:p1",
        backendType: "herdr",
        workspaceId: "w1B",
        startedAt: new Date().toISOString(),
      };
      const deps = makeDeps({
        readSession: vi.fn(async () => herdrSession),
        listHerdrPanes: vi.fn(async () => [
          { paneId: "w1B:p1", workspaceId: "w1B", title: "claude", cwd: "/tmp", agentStatus: "working" as const },
        ]),
        confirm: vi.fn(async () => true),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.listHerdrPanes).toHaveBeenCalled();
      expect(deps.listWeztermPanes).not.toHaveBeenCalled();
      expect(deps.listTmuxPanes).not.toHaveBeenCalled();
    });

    test("confirms before resuming when the pane list is unavailable", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({
        readSession: vi.fn(async () => runningSession),
        listWeztermPanes: vi.fn(async () => null),
        confirm: vi.fn(async () => false),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.confirm).toHaveBeenCalledWith("Continue anyway?");
      expect(deps.saveSession).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test("proceeds when the user confirms despite an unknown session status", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({
        readSession: vi.fn(async () => runningSession),
        listWeztermPanes: vi.fn(async () => null),
        confirm: vi.fn(async () => true),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.saveSession).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test("reports why the pane list could not be read", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({
        readSession: vi.fn(async () => runningSession),
        listWeztermPanes: vi.fn(async () => {
          throw new Error("wezterm cli exploded");
        }),
        confirm: vi.fn(async () => false),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      const warned = warnSpy.mock.calls.flat().join("\n");
      expect(warned).toContain("Could not determine whether a Claude session is still running");
      expect(warned).toContain("wezterm cli exploded");
      expect(deps.confirm).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("pane mode", () => {
    test("creates pane and sends command", async () => {
      const deps = makeDeps();
      await runResume({ branchName: "feature/test", pane: true }, deps);

      const backend = await (deps.ensurePaneBackend as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(backend.createPane).toHaveBeenCalledWith({
        keepFocus: true,
        cwd: expect.any(String),
        label: expect.any(String),
      });
      const sendCommandCall = (backend.sendCommand as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sendCommandCall[0]).toBe("42");
      expect(sendCommandCall[1]).toContain(tempDir);
      expect(sendCommandCall[1]).toContain("claude --continue");
      expect(deps.saveSession).toHaveBeenCalledWith(tempDir, {
        paneId: 42,
        backendType: "wezterm",
        mode: "pane",
        startedAt: expect.any(String),
      });
    });

    test("uses the configured herdr label template when launching in a pane", async () => {
      const deps = makeDeps({
        loadProjectConfig: vi.fn(async () => ({ herdr: { label: "{branch}@{repo}" } })),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      const backend = await (deps.ensurePaneBackend as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(backend.createPane).toHaveBeenCalledWith({
        keepFocus: true,
        cwd: expect.any(String),
        label: "feature/test@repo",
      });
    });

    test("saves workspaceId in the session when the herdr backend returns one", async () => {
      const deps = makeDeps({
        ensurePaneBackend: vi.fn(async () => ({
          name: "herdr" as const,
          createPane: vi.fn(async () => ({ paneId: "w1B:p1", workspaceId: "w1B" })),
          sendCommand: vi.fn(async () => {}),
          closePane: vi.fn(async () => {}),
        })),
      });

      await runResume({ branchName: "feature/test", pane: true }, deps);

      expect(deps.saveSession).toHaveBeenCalledWith(
        tempDir,
        expect.objectContaining({ backendType: "herdr", paneId: "w1B:p1", workspaceId: "w1B", mode: "pane" }),
      );
    });

    test("throws when no pane backend available", async () => {
      const deps = makeDeps({
        ensurePaneBackend: vi.fn(async () => {
          throw new DependencyError("requires WezTerm or tmux");
        }),
      });

      await expect(runResume({ branchName: "feature/test", pane: true }, deps)).rejects.toThrow(
        "requires WezTerm or tmux",
      );
    });

    test("does not check WezTerm when pane is not specified", async () => {
      const deps = makeDeps();
      await runResume({}, deps);
      expect(deps.ensurePaneBackend).not.toHaveBeenCalled();
    });

    test("shell-escapes the worktree path sent to the pane", async () => {
      const hostileDir = join(tempDir, 'pane"$x;`y`');
      await mkdir(hostileDir, { recursive: true });

      const sendCommand = vi.fn(async (_paneId: string, _command: string) => {});
      const deps = makeDeps({
        ensurePaneBackend: vi.fn(async () => ({
          name: "wezterm" as const,
          createPane: vi.fn(async () => ({ paneId: "42" })),
          sendCommand,
          closePane: vi.fn(async () => {}),
        })),
        listWorktrees: async () => ({
          worktrees: [
            makeWorktree({ path: "/repo", branch: "main", isMain: true }),
            makeWorktree({ path: hostileDir, branch: "feature/hostile" }),
          ],
          mainBranch: "main",
        }),
      });

      await runResume({ branchName: "feature/hostile", pane: true }, deps);

      const sentCommand = sendCommand.mock.calls[0][1] as string;
      expect(sentCommand).toBe(`cd '${hostileDir}' && claude --continue`);
      expect(sentCommand.startsWith('cd "')).toBe(false);
    });
  });
});

// ============================================================================
// buildPaneResumeCommand (shell injection regression)
// ============================================================================

describe("buildPaneResumeCommand", () => {
  // A branch name may legally contain these characters, and getWorktreePath passes
  // them straight through into the worktree path.
  const hostilePath = "/w/a\"b$c;d'e`f";

  test("wraps the worktree path in single quotes and escapes embedded quotes", () => {
    expect(buildPaneResumeCommand(hostilePath, "claude --continue")).toBe(
      "cd '/w/a\"b$c;d'\\''e`f' && claude --continue",
    );
  });

  test("the shell reads the hostile path as a single cd argument", async () => {
    const dirName = "a\"b$c;d'e`f";
    const hostileDir = join(tempDir, dirName);
    await mkdir(hostileDir, { recursive: true });

    // `pwd` stands in for the claude command: if the path escaped its quoting, the
    // shell would run something else or fail instead of printing the directory.
    const command = buildPaneResumeCommand(hostileDir, "pwd");
    const output = execFileSync("sh", ["-c", command], { encoding: "utf-8" }).trim();

    expect(output).toBe(hostileDir);
  });
});
