import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { SessionInfo, WeztermPane } from "../types";
import {
  completeSession,
  deleteSession,
  determineSessionStatus,
  formatElapsed,
  readSession,
  saveSession,
} from "./session";

// ============================================================================
// Pure function tests
// ============================================================================

describe("determineSessionStatus", () => {
  const now = new Date("2025-01-15T12:00:00Z");

  test("completedAt set → done", () => {
    const session: SessionInfo = {
      mode: "terminal",
      startedAt: "2025-01-15T11:45:00Z",
      completedAt: "2025-01-15T11:50:00Z",
    };
    const result = determineSessionStatus(session, [], now);
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
    const panes: WeztermPane[] = [{ pane_id: 42, title: "claude", cwd: "/tmp" }];
    const result = determineSessionStatus(session, panes, now);
    expect(result.status).toBe("running");
    expect(result.paneId).toBe(42);
  });

  test("pane mode with missing pane → done", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const panes: WeztermPane[] = [{ pane_id: 99, title: "other", cwd: "/tmp" }];
    const result = determineSessionStatus(session, panes, now);
    expect(result.status).toBe("done");
  });

  test("pane mode with empty pane list → done", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const result = determineSessionStatus(session, [], now);
    expect(result.status).toBe("done");
  });

  test("terminal mode without completedAt → running", () => {
    const session: SessionInfo = {
      mode: "terminal",
      startedAt: "2025-01-15T11:45:00Z",
    };
    const result = determineSessionStatus(session, [], now);
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
    const panes: WeztermPane[] = [{ pane_id: 42, title: "claude", cwd: "/tmp" }];
    const result = determineSessionStatus(session, panes, now);
    expect(result.status).toBe("done");
  });

  test("pane mode with null panes (WezTerm unavailable) → running", () => {
    const session: SessionInfo = {
      mode: "pane",
      paneId: 42,
      startedAt: "2025-01-15T11:45:00Z",
    };
    const result = determineSessionStatus(session, null, now);
    expect(result.status).toBe("running");
    expect(result.paneId).toBe(42);
  });

  test("elapsed time is calculated correctly", () => {
    const session: SessionInfo = {
      mode: "terminal",
      startedAt: "2025-01-15T10:30:00Z",
    };
    const result = determineSessionStatus(session, [], now);
    expect(result.elapsedMs).toBe(90 * 60_000);
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

  beforeEach(async () => {
    tempDir = join(tmpdir(), `claude-worktree-session-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.CLAUDE_WORKTREE_CACHE_DIR;
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
});
