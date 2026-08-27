import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { saveEnv } from "../__test-utils__.ts";
import type { AllPanes, SessionInfo, WeztermPane } from "../types/index.ts";

// Speed up lock acquisition failure tests by using minimal retries
vi.mock("./cache.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./cache.ts")>();
  return {
    ...mod,
    withLock: (lockFile: string, fn: () => Promise<unknown>) =>
      mod.withLock(lockFile, fn, { maxRetries: 2, retryIntervalMs: 1 }),
  };
});

import {
  completeSession,
  deleteSession,
  determineSessionStatus,
  fetchAllPanes,
  formatElapsed,
  gcMissingSessions,
  gcSessions,
  readAllSessions,
  readSession,
  saveSession,
} from "./session.ts";

// ============================================================================
// Pure function tests
// ============================================================================

describe("fetchAllPanes", () => {
  test("returns panes from both backends", async () => {
    const weztermPanes = [{ paneId: 1, title: "test", cwd: "/tmp" }];
    const tmuxPanes = [{ paneId: "%0", title: "test", cwd: "/tmp" }];
    const result = await fetchAllPanes({
      listWeztermPanes: async () => weztermPanes,
      listTmuxPanes: async () => tmuxPanes,
    });
    expect(result).toEqual({ wezterm: weztermPanes, tmux: tmuxPanes });
  });

  test("returns null for backends that fail", async () => {
    const result = await fetchAllPanes({
      listWeztermPanes: async () => {
        throw new Error("wezterm not found");
      },
      listTmuxPanes: async () => {
        throw new Error("tmux not found");
      },
    });
    expect(result).toEqual({ wezterm: null, tmux: null });
  });

  test("returns null only for the failing backend", async () => {
    const weztermPanes = [{ paneId: 1, title: "test", cwd: "/tmp" }];
    const result = await fetchAllPanes({
      listWeztermPanes: async () => weztermPanes,
      listTmuxPanes: async () => {
        throw new Error("tmux not found");
      },
    });
    expect(result).toEqual({ wezterm: weztermPanes, tmux: null });
  });
});

describe("determineSessionStatus", () => {
  const now = new Date("2025-01-15T12:00:00Z");
  const noPanes: AllPanes = { wezterm: null, tmux: null };
  const emptyPanes: AllPanes = { wezterm: [], tmux: null };

  test("completedAt set → done", () => {
    const session: SessionInfo = {
      mode: "terminal",
      startedAt: "2025-01-15T11:45:00Z",
      completedAt: "2025-01-15T11:50:00Z",
    };
    const result = determineSessionStatus(session, emptyPanes, now);
    expect(result.status).toBe("done");
    expect(result.elapsedMs).toBe(15 * 60_000);
    expect(result.mode).toBe("terminal");
  });

  test("pane mode with existing pane → running", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const panes: WeztermPane[] = [{ paneId: 42, title: "claude", cwd: "/tmp" }];
    const result = determineSessionStatus(session, { wezterm: panes, tmux: null }, now);
    expect(result.status).toBe("running");
    expect(result.paneId).toBe(42);
  });

  test("pane mode with missing pane → done", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const panes: WeztermPane[] = [{ paneId: 99, title: "other", cwd: "/tmp" }];
    const result = determineSessionStatus(session, { wezterm: panes, tmux: null }, now);
    expect(result.status).toBe("done");
  });

  test("pane mode with empty pane list → done", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const result = determineSessionStatus(session, emptyPanes, now);
    expect(result.status).toBe("done");
  });

  test("terminal mode without completedAt → running", () => {
    const session: SessionInfo = {
      mode: "terminal",
      startedAt: "2025-01-15T11:45:00Z",
    };
    const result = determineSessionStatus(session, emptyPanes, now);
    expect(result.status).toBe("running");
    expect(result.mode).toBe("terminal");
  });

  test("pane mode with completedAt set → done (takes priority)", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
      completedAt: "2025-01-15T11:50:00Z",
    };
    const panes: WeztermPane[] = [{ paneId: 42, title: "claude", cwd: "/tmp" }];
    const result = determineSessionStatus(session, { wezterm: panes, tmux: null }, now);
    expect(result.status).toBe("done");
  });

  test("pane mode with null panes (WezTerm unavailable) → unknown", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const result = determineSessionStatus(session, noPanes, now);
    expect(result.status).toBe("unknown");
    expect(result.paneId).toBe(42);
  });

  test("tmux pane mode with null tmux panes (tmux unavailable) → unknown", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: "%42",
      backendType: "tmux",
      startedAt: "2025-01-15T11:45:00Z",
    };
    const allPanes: AllPanes = { wezterm: [{ paneId: 99, title: "other", cwd: "/tmp" }], tmux: null };
    const result = determineSessionStatus(session, allPanes, now);
    expect(result.status).toBe("unknown");
    expect(result.paneId).toBe("%42");
  });

  test("elapsed time is calculated correctly", () => {
    const session: SessionInfo = {
      mode: "terminal",
      startedAt: "2025-01-15T10:30:00Z",
    };
    const result = determineSessionStatus(session, emptyPanes, now);
    expect(result.elapsedMs).toBe(90 * 60_000);
  });

  test("tmux pane mode with existing pane → running", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: "%42",
      backendType: "tmux",
      startedAt: "2025-01-15T11:45:00Z",
    };
    const allPanes: AllPanes = { wezterm: null, tmux: [{ paneId: "%42", title: "claude", cwd: "/tmp" }] };
    const result = determineSessionStatus(session, allPanes, now);
    expect(result.status).toBe("running");
    expect(result.paneId).toBe("%42");
  });

  test("tmux pane mode with missing pane → done", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: "%42",
      backendType: "tmux",
      startedAt: "2025-01-15T11:45:00Z",
    };
    const allPanes: AllPanes = { wezterm: null, tmux: [{ paneId: "%99", title: "other", cwd: "/tmp" }] };
    const result = determineSessionStatus(session, allPanes, now);
    expect(result.status).toBe("done");
  });

  test("session without backendType defaults to wezterm", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const allPanes: AllPanes = { wezterm: [{ paneId: 42, title: "claude", cwd: "/tmp" }], tmux: null };
    const result = determineSessionStatus(session, allPanes, now);
    expect(result.status).toBe("running");
  });
});

describe("formatElapsed", () => {
  test("0 minutes", () => {
    expect(formatElapsed(0)).toBe("0m");
  });

  test("less than 1 minute", () => {
    expect(formatElapsed(30_000)).toBe("0m");
  });

  test("15 minutes", () => {
    expect(formatElapsed(15 * 60_000)).toBe("15m");
  });

  test("59 minutes", () => {
    expect(formatElapsed(59 * 60_000)).toBe("59m");
  });

  test("exactly 1 hour", () => {
    expect(formatElapsed(60 * 60_000)).toBe("1h");
  });

  test("1 hour 30 minutes", () => {
    expect(formatElapsed(90 * 60_000)).toBe("1h30m");
  });

  test("2 hours", () => {
    expect(formatElapsed(120 * 60_000)).toBe("2h");
  });

  test("2 hours 5 minutes", () => {
    expect(formatElapsed(125 * 60_000)).toBe("2h5m");
  });
});

// ============================================================================
// File I/O tests (using temp directory)
// ============================================================================

describe("session file I/O", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `claude-worktree-session-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    restoreEnv = saveEnv("CLAUDE_WORKTREE_CACHE_DIR");
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
  });

  afterEach(async () => {
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("saveSession and readSession round-trip", async () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 10,
      startedAt: "2025-01-15T11:00:00Z",
    };
    await saveSession("/tmp/wt-1", session);
    const result = await readSession("/tmp/wt-1");
    expect(result).toEqual(session);
  });

  test("readSession returns undefined for non-existent path", async () => {
    const result = await readSession("/tmp/non-existent");
    expect(result).toBeUndefined();
  });

  test("completeSession sets completedAt", async () => {
    const session: SessionInfo = {
      mode: "terminal",
      startedAt: "2025-01-15T11:00:00Z",
    };
    await saveSession("/tmp/wt-2", session);
    await completeSession("/tmp/wt-2");
    const result = await readSession("/tmp/wt-2");
    expect(result?.completedAt).toBeDefined();
  });

  test("completeSession does nothing for non-existent path", async () => {
    await completeSession("/tmp/non-existent");
    const result = await readSession("/tmp/non-existent");
    expect(result).toBeUndefined();
  });

  test("deleteSession removes session", async () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 5,
      startedAt: "2025-01-15T11:00:00Z",
    };
    await saveSession("/tmp/wt-3", session);
    await deleteSession("/tmp/wt-3");
    const result = await readSession("/tmp/wt-3");
    expect(result).toBeUndefined();
  });

  test("deleteSession does nothing for non-existent path", async () => {
    await deleteSession("/tmp/non-existent");
    // Should not throw
  });

  test("multiple sessions are stored independently", async () => {
    const session1: SessionInfo = { mode: "pane", paneId: 1, startedAt: "2025-01-15T11:00:00Z" };
    const session2: SessionInfo = { mode: "terminal", startedAt: "2025-01-15T12:00:00Z" };
    await saveSession("/tmp/wt-a", session1);
    await saveSession("/tmp/wt-b", session2);

    expect(await readSession("/tmp/wt-a")).toEqual(session1);
    expect(await readSession("/tmp/wt-b")).toEqual(session2);

    await deleteSession("/tmp/wt-a");
    expect(await readSession("/tmp/wt-a")).toBeUndefined();
    expect(await readSession("/tmp/wt-b")).toEqual(session2);
  });

  test("deleteSession removes file when last session is deleted", async () => {
    const session: SessionInfo = { mode: "pane", paneId: 1, startedAt: "2025-01-15T11:00:00Z" };
    await saveSession("/tmp/wt-only", session);
    await deleteSession("/tmp/wt-only");

    expect(existsSync(join(tempDir, "sessions.json"))).toBe(false);
  });

  test("lock acquisition failure throws LockAcquisitionError", async () => {
    // Create the lock file with current PID to simulate a held lock
    const lockFile = join(tempDir, "sessions.lock");
    await writeFile(lockFile, String(process.pid), "utf-8");

    const { LockAcquisitionError } = await import("./errors.ts");
    const session: SessionInfo = { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" };
    await expect(saveSession("/tmp/wt-lock-test", session)).rejects.toThrow(LockAcquisitionError);
  });
});

// ============================================================================
// GC tests
// ============================================================================

describe("gcSessions", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `claude-worktree-gc-session-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    restoreEnv = saveEnv("CLAUDE_WORKTREE_CACHE_DIR");
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
  });

  afterEach(async () => {
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("removes sessions not in validPaths", async () => {
    await saveSession("/tmp/wt-valid", { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" });
    await saveSession("/tmp/wt-stale", { mode: "pane", paneId: 1, startedAt: "2025-01-15T12:00:00Z" });

    const removed = await gcSessions(new Set(["/tmp/wt-valid"]));

    expect(removed).toBe(1);
    expect(await readSession("/tmp/wt-valid")).toBeDefined();
    expect(await readSession("/tmp/wt-stale")).toBeUndefined();
  });

  test("returns 0 when all sessions are valid", async () => {
    await saveSession("/tmp/wt-a", { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" });

    const removed = await gcSessions(new Set(["/tmp/wt-a"]));

    expect(removed).toBe(0);
    expect(await readSession("/tmp/wt-a")).toBeDefined();
  });

  test("returns 0 when no sessions exist", async () => {
    const removed = await gcSessions(new Set(["/tmp/wt-a"]));

    expect(removed).toBe(0);
  });

  test("removes file when all sessions are stale", async () => {
    await saveSession("/tmp/wt-stale", { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" });

    const removed = await gcSessions(new Set());

    expect(removed).toBe(1);
    expect(existsSync(join(tempDir, "sessions.json"))).toBe(false);
  });

  test("removes multiple stale sessions", async () => {
    await saveSession("/tmp/wt-valid", { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" });
    await saveSession("/tmp/wt-stale1", { mode: "terminal", startedAt: "2025-01-15T12:00:00Z" });
    await saveSession("/tmp/wt-stale2", { mode: "pane", paneId: 2, startedAt: "2025-01-15T13:00:00Z" });

    const removed = await gcSessions(new Set(["/tmp/wt-valid"]));

    expect(removed).toBe(2);
    const all = await readAllSessions();
    expect(Object.keys(all)).toEqual(["/tmp/wt-valid"]);
  });
});

// ============================================================================
// Corrupt cache handling (B1)
// ============================================================================

describe("corrupt session cache", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `claude-worktree-corrupt-session-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
    restoreEnv = saveEnv("CLAUDE_WORKTREE_CACHE_DIR");
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("readSession does not throw and returns undefined", async () => {
    await writeFile(join(tempDir, "sessions.json"), "{ this is not json", "utf-8");

    await expect(readSession("/tmp/wt-1")).resolves.toBeUndefined();
  });

  test("readAllSessions does not throw and returns an empty object", async () => {
    await writeFile(join(tempDir, "sessions.json"), "{ this is not json", "utf-8");

    await expect(readAllSessions()).resolves.toEqual({});
  });

  test("saveSession does not throw, persists the value, and quarantines the corrupt file", async () => {
    const corruptContent = "{ this is not json";
    await writeFile(join(tempDir, "sessions.json"), corruptContent, "utf-8");

    const session: SessionInfo = { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" };
    await expect(saveSession("/tmp/wt-1", session)).resolves.toBeUndefined();

    expect(await readSession("/tmp/wt-1")).toEqual(session);

    const quarantined = readdirSync(tempDir).filter((name) => name.startsWith("sessions.json.corrupt-"));
    expect(quarantined).toHaveLength(1);
    const quarantinedContent = await readFile(join(tempDir, quarantined[0]), "utf-8");
    expect(quarantinedContent).toBe(corruptContent);
  });

  test("completeSession does not throw", async () => {
    await writeFile(join(tempDir, "sessions.json"), "{ this is not json", "utf-8");

    await expect(completeSession("/tmp/wt-1")).resolves.toBeUndefined();
  });

  test("deleteSession does not throw", async () => {
    await writeFile(join(tempDir, "sessions.json"), "{ this is not json", "utf-8");

    await expect(deleteSession("/tmp/wt-1")).resolves.toBeUndefined();
  });

  test("gcSessions does not throw and returns 0", async () => {
    await writeFile(join(tempDir, "sessions.json"), "{ this is not json", "utf-8");

    await expect(gcSessions(new Set())).resolves.toBe(0);
  });

  test("structurally invalid but parseable JSON degrades to an empty cache", async () => {
    await writeFile(join(tempDir, "sessions.json"), JSON.stringify({ "/tmp/wt": { mode: "bogus" } }), "utf-8");

    await expect(readAllSessions()).resolves.toEqual({});

    const session: SessionInfo = { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" };
    await expect(saveSession("/tmp/wt-2", session)).resolves.toBeUndefined();
    expect(await readSession("/tmp/wt-2")).toEqual(session);
  });
});

// ============================================================================
// gcMissingSessions tests (B3)
// ============================================================================

describe("gcMissingSessions", () => {
  let tempDir: string;
  let restoreEnv: () => void;
  let worktreeDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `claude-worktree-gc-missing-session-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
    restoreEnv = saveEnv("CLAUDE_WORKTREE_CACHE_DIR");
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
    worktreeDir = mkdtempSync(join(tmpdir(), "claude-worktree-gc-missing-session-wt-"));
  });

  afterEach(async () => {
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
    try {
      rmSync(worktreeDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("removes only sessions whose worktree path no longer exists", async () => {
    await saveSession(worktreeDir, { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" });
    await saveSession("/tmp/does-not-exist-session", { mode: "terminal", startedAt: "2025-01-15T12:00:00Z" });

    const removed = await gcMissingSessions();

    expect(removed).toBe(1);
    expect(await readSession(worktreeDir)).toBeDefined();
    expect(await readSession("/tmp/does-not-exist-session")).toBeUndefined();
  });

  test("returns 0 when all worktree paths exist", async () => {
    await saveSession(worktreeDir, { mode: "terminal", startedAt: "2025-01-15T11:00:00Z" });

    const removed = await gcMissingSessions();

    expect(removed).toBe(0);
    expect(await readSession(worktreeDir)).toBeDefined();
  });
});
