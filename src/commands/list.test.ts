import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  CommitInfo,
  ListArgs,
  ListDeps,
  SessionState,
  WorktreeInfo,
  WorktreeListEntry,
  WorktreeStatus,
} from "../types.ts";
import {
  executeList,
  formatAheadBehind,
  formatRelativeTime,
  formatSessionState,
  formatSummary,
  formatWorktreeEntry,
  getStatusBadge,
  shortenPath,
  truncate,
} from "./list.ts";

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

function makeCommitInfo(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: "abc1234",
    message: "Fix typo in README",
    date: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

function makeListEntry(overrides: Partial<WorktreeListEntry> = {}): WorktreeListEntry {
  const defaultStatus = makeStatus();
  return {
    worktree: defaultStatus.worktree,
    status: defaultStatus,
    commit: makeCommitInfo(),
    aheadBehind: null,
    ...overrides,
  };
}

const noopSpinner = (_message: string) => ({
  stop: (_finalMessage?: string) => {},
  fail: (_message: string) => {},
  updateTail: (_lines: string[]) => {},
});

function makeListDeps(overrides: Partial<ListDeps> = {}): ListDeps {
  return {
    fetchAndPrune: async () => {},
    listWorktrees: async () => [],
    getWorktreeStatuses: async () => [],
    getLastCommit: async () => makeCommitInfo(),
    getAheadBehind: async () => null,
    getMainBranch: async () => "main",
    startSpinner: noopSpinner,
    readAllSessions: async () => ({}),
    listWeztermPanes: async () => null,
    ...overrides,
  };
}

const defaultArgs: ListArgs = { json: false, verbose: false, status: false };

// Suppress console output
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// ============================================================================
// Pure function tests
// ============================================================================

describe("formatRelativeTime", () => {
  const now = new Date("2025-01-15T12:00:00Z");

  test("just now (< 60s)", () => {
    const date = new Date("2025-01-15T11:59:30Z");
    expect(formatRelativeTime(date, now)).toBe("just now");
  });

  test("1 minute ago", () => {
    const date = new Date("2025-01-15T11:59:00Z");
    expect(formatRelativeTime(date, now)).toBe("1 minute ago");
  });

  test("5 minutes ago", () => {
    const date = new Date("2025-01-15T11:55:00Z");
    expect(formatRelativeTime(date, now)).toBe("5 minutes ago");
  });

  test("1 hour ago", () => {
    const date = new Date("2025-01-15T11:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("1 hour ago");
  });

  test("3 hours ago", () => {
    const date = new Date("2025-01-15T09:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("3 hours ago");
  });

  test("1 day ago", () => {
    const date = new Date("2025-01-14T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("1 day ago");
  });

  test("5 days ago", () => {
    const date = new Date("2025-01-10T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("5 days ago");
  });

  test("2 weeks ago", () => {
    const date = new Date("2025-01-01T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("2 weeks ago");
  });

  test("3 months ago", () => {
    const date = new Date("2024-10-15T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("3 months ago");
  });

  test("1 year ago", () => {
    const date = new Date("2024-01-15T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("1 year ago");
  });

  test("2 years ago", () => {
    const date = new Date("2023-01-15T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("2 years ago");
  });
});

describe("truncate", () => {
  test("returns text unchanged if within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("returns text unchanged if exactly at limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  test("truncates with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  test("handles very short max length", () => {
    expect(truncate("hello", 3)).toBe("...");
  });
});

describe("shortenPath", () => {
  test("returns relative path from repo root", () => {
    expect(shortenPath("/home/user/repo-feature-test", "/home/user/repo")).toBe("../repo-feature-test");
  });

  test("returns path for same directory", () => {
    expect(shortenPath("/home/user/repo", "/home/user/repo")).toBe("");
  });
});

describe("getStatusBadge", () => {
  test("main worktree", () => {
    const status = makeStatus({ isMain: true });
    const badge = getStatusBadge(status);
    expect(badge.icon).toBe("*");
    expect(badge.label).toBe("Main");
  });

  test("locked worktree", () => {
    const status = makeStatus({ isLocked: true });
    const badge = getStatusBadge(status);
    expect(badge.label).toBe("Locked");
  });

  test("merged worktree", () => {
    const status = makeStatus({}, { branchMerged: true });
    const badge = getStatusBadge(status);
    expect(badge.icon).toBe("✓");
    expect(badge.label).toBe("Merged");
  });

  test("dirty worktree", () => {
    const status = makeStatus({ isDirty: true });
    const badge = getStatusBadge(status);
    expect(badge.icon).toBe("!");
    expect(badge.label).toBe("Dirty");
  });

  test("active worktree (default)", () => {
    const status = makeStatus();
    const badge = getStatusBadge(status);
    expect(badge.icon).toBe("●");
    expect(badge.label).toBe("Active");
  });
});

describe("formatAheadBehind", () => {
  test("null returns empty string", () => {
    expect(formatAheadBehind(null)).toBe("");
  });

  test("ahead only", () => {
    expect(formatAheadBehind({ ahead: 3, behind: 0 })).toBe("↑3");
  });

  test("behind only", () => {
    expect(formatAheadBehind({ ahead: 0, behind: 2 })).toBe("↓2");
  });

  test("both ahead and behind", () => {
    expect(formatAheadBehind({ ahead: 3, behind: 1 })).toBe("↑3 ↓1");
  });

  test("both zero", () => {
    expect(formatAheadBehind({ ahead: 0, behind: 0 })).toBe("");
  });
});

describe("formatSummary", () => {
  test("single main worktree", () => {
    const entry = makeListEntry({
      status: makeStatus({ isMain: true }),
      worktree: makeWorktree({ isMain: true }),
    });
    const summary = formatSummary([entry]);
    expect(summary).toContain("1 worktree");
    expect(summary).toContain("1 main");
  });

  test("mixed statuses", () => {
    const entries = [
      makeListEntry({
        status: makeStatus({ isMain: true }),
        worktree: makeWorktree({ isMain: true }),
      }),
      makeListEntry({
        status: makeStatus(),
        worktree: makeWorktree(),
      }),
      makeListEntry({
        status: makeStatus({ isDirty: true }),
        worktree: makeWorktree({ isDirty: true }),
      }),
    ];
    const summary = formatSummary(entries);
    expect(summary).toContain("3 worktrees");
    expect(summary).toContain("1 main");
    expect(summary).toContain("1 active");
    expect(summary).toContain("1 dirty");
  });
});

describe("formatWorktreeEntry", () => {
  test("returns 3 lines", () => {
    const entry = makeListEntry();
    const lines = formatWorktreeEntry(entry, "/tmp/repo", false);
    expect(lines).toHaveLength(3);
  });

  test("includes branch name in line 1", () => {
    const entry = makeListEntry();
    const lines = formatWorktreeEntry(entry, "/tmp/repo", false);
    expect(lines[0]).toContain("feature/test");
  });

  test("includes commit hash in line 2", () => {
    const entry = makeListEntry({
      commit: makeCommitInfo({ hash: "def5678" }),
    });
    const lines = formatWorktreeEntry(entry, "/tmp/repo", false);
    expect(lines[1]).toContain("def5678");
  });

  test("shows (no commits) when commit is null", () => {
    const entry = makeListEntry({ commit: null });
    const lines = formatWorktreeEntry(entry, "/tmp/repo", false);
    expect(lines[1]).toContain("(no commits)");
  });

  test("includes path in line 3", () => {
    const entry = makeListEntry();
    const lines = formatWorktreeEntry(entry, "/tmp", false);
    expect(lines[2]).toContain("repo-feature-test");
  });

  test("verbose mode shows full path", () => {
    const entry = makeListEntry();
    const lines = formatWorktreeEntry(entry, "/tmp", true);
    expect(lines[2]).toContain("/tmp/repo-feature-test");
  });

  test("truncates long commit message in non-verbose mode", () => {
    const longMessage = "A".repeat(60);
    const entry = makeListEntry({
      commit: makeCommitInfo({ message: longMessage }),
    });
    const lines = formatWorktreeEntry(entry, "/tmp/repo", false);
    expect(lines[1]).toContain("...");
  });

  test("detached HEAD shows (detached)", () => {
    const status = makeStatus({ branch: null });
    const entry = makeListEntry({
      worktree: makeWorktree({ branch: null }),
      status,
    });
    const lines = formatWorktreeEntry(entry, "/tmp/repo", false);
    expect(lines[0]).toContain("(detached)");
  });
});

// ============================================================================
// DI-based integration tests
// ============================================================================

describe("executeList", () => {
  test("empty worktree list", async () => {
    const deps = makeListDeps({
      listWorktrees: async () => [],
    });

    const result = await executeList(defaultArgs, deps);

    expect(result.entries).toEqual([]);
  });

  test("single main worktree", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const mainStatus = makeStatus({ isMain: true, branch: "main", path: "/repo" }, { reason: "Main worktree" });
    const deps = makeListDeps({
      listWorktrees: async () => [mainWt],
      getWorktreeStatuses: async () => [mainStatus],
      getLastCommit: async () => makeCommitInfo(),
    });

    const result = await executeList(defaultArgs, deps);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].worktree.isMain).toBe(true);
  });

  test("mixed statuses", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const featureWt = makeWorktree({ branch: "feature/auth", path: "/repo-feature-auth" });
    const dirtyWt = makeWorktree({ branch: "feature/api", path: "/repo-feature-api", isDirty: true });

    const statuses = [
      makeStatus({ isMain: true, branch: "main", path: "/repo" }, { reason: "Main worktree" }),
      makeStatus({ branch: "feature/auth", path: "/repo-feature-auth" }, { reason: "Active" }),
      makeStatus(
        { branch: "feature/api", path: "/repo-feature-api", isDirty: true },
        { reason: "Has uncommitted changes" },
      ),
    ];

    const deps = makeListDeps({
      listWorktrees: async () => [mainWt, featureWt, dirtyWt],
      getWorktreeStatuses: async () => statuses,
      getLastCommit: async () => makeCommitInfo(),
      getAheadBehind: async () => ({ ahead: 2, behind: 0 }),
    });

    const result = await executeList(defaultArgs, deps);

    expect(result.entries).toHaveLength(3);
  });

  test("JSON mode outputs valid JSON", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const mainStatus = makeStatus({ isMain: true, branch: "main", path: "/repo" }, { reason: "Main worktree" });

    let jsonOutput = "";
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      jsonOutput += msg;
    });

    const deps = makeListDeps({
      listWorktrees: async () => [mainWt],
      getWorktreeStatuses: async () => [mainStatus],
      getLastCommit: async () => makeCommitInfo(),
    });

    const result = await executeList({ json: true, verbose: false, status: false }, deps);

    expect(result.entries).toHaveLength(1);
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.worktrees).toHaveLength(1);
    expect(parsed.worktrees[0].branch).toBe("main");
    expect(parsed.worktrees[0].status).toBe("Main");
  });

  test("fetchAndPrune failure does not block list", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const mainStatus = makeStatus({ isMain: true, branch: "main", path: "/repo" });

    const deps = makeListDeps({
      fetchAndPrune: async () => {
        throw new Error("Network error");
      },
      listWorktrees: async () => [mainWt],
      getWorktreeStatuses: async () => [mainStatus],
      getLastCommit: async () => makeCommitInfo(),
    });

    const result = await executeList(defaultArgs, deps);

    expect(result.entries).toHaveLength(1);
  });

  test("null commit is handled gracefully", async () => {
    const wt = makeWorktree({ branch: "feature/new", path: "/repo-feature-new" });
    const status = makeStatus({ branch: "feature/new", path: "/repo-feature-new" });

    const deps = makeListDeps({
      listWorktrees: async () => [wt],
      getWorktreeStatuses: async () => [status],
      getLastCommit: async () => null,
    });

    const result = await executeList(defaultArgs, deps);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].commit).toBeNull();
  });

  test("getAheadBehind is not called for main worktree", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const mainStatus = makeStatus({ isMain: true, branch: "main", path: "/repo" });

    let aheadBehindCalled = false;
    const deps = makeListDeps({
      listWorktrees: async () => [mainWt],
      getWorktreeStatuses: async () => [mainStatus],
      getLastCommit: async () => makeCommitInfo(),
      getAheadBehind: async () => {
        aheadBehindCalled = true;
        return { ahead: 0, behind: 0 };
      },
    });

    await executeList(defaultArgs, deps);

    expect(aheadBehindCalled).toBe(false);
  });

  test("JSON mode with null commit", async () => {
    const wt = makeWorktree({ branch: "feature/x", path: "/repo-feature-x" });
    const status = makeStatus({ branch: "feature/x", path: "/repo-feature-x" });

    let jsonOutput = "";
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      jsonOutput += msg;
    });

    const deps = makeListDeps({
      listWorktrees: async () => [wt],
      getWorktreeStatuses: async () => [status],
      getLastCommit: async () => null,
    });

    await executeList({ json: true, verbose: false, status: false }, deps);

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.worktrees[0].commit).toBeNull();
  });

  test("empty list in JSON mode", async () => {
    let jsonOutput = "";
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      jsonOutput += msg;
    });

    const deps = makeListDeps({
      listWorktrees: async () => [],
    });

    await executeList({ json: true, verbose: false, status: false }, deps);

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.worktrees).toEqual([]);
  });

  test("spinner is not started in JSON mode", async () => {
    let spinnerStarted = false;
    const deps = makeListDeps({
      startSpinner: (_message: string) => {
        spinnerStarted = true;
        return { stop: () => {}, fail: (_msg: string) => {}, updateTail: (_lines: string[]) => {} };
      },
    });

    await executeList({ json: true, verbose: false, status: false }, deps);

    expect(spinnerStarted).toBe(false);
  });

  test("spinner stop is called on success", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const mainStatus = makeStatus({ isMain: true, branch: "main", path: "/repo" });

    let stopped = false;
    const deps = makeListDeps({
      listWorktrees: async () => [mainWt],
      getWorktreeStatuses: async () => [mainStatus],
      getLastCommit: async () => makeCommitInfo(),
      startSpinner: (_message: string) => ({
        stop: () => {
          stopped = true;
        },
        fail: (_msg: string) => {},
        updateTail: (_lines: string[]) => {},
      }),
    });

    await executeList(defaultArgs, deps);

    expect(stopped).toBe(true);
  });

  test("spinner fail is called on error", async () => {
    let failMessage = "";
    const deps = makeListDeps({
      listWorktrees: async () => {
        throw new Error("git error");
      },
      startSpinner: (_message: string) => ({
        stop: () => {},
        fail: (msg: string) => {
          failMessage = msg;
        },
        updateTail: (_lines: string[]) => {},
      }),
    });

    await expect(executeList(defaultArgs, deps)).rejects.toThrow("git error");

    expect(failMessage).toBe("Failed to fetch worktree information");
  });

  test("sessions are not fetched when status flag is false", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const mainStatus = makeStatus({ isMain: true, branch: "main", path: "/repo" });

    let readAllSessionsCalled = false;
    const deps = makeListDeps({
      listWorktrees: async () => [mainWt],
      getWorktreeStatuses: async () => [mainStatus],
      getLastCommit: async () => makeCommitInfo(),
      readAllSessions: async () => {
        readAllSessionsCalled = true;
        return {};
      },
    });

    await executeList(defaultArgs, deps);

    expect(readAllSessionsCalled).toBe(false);
  });

  test("session status is fetched when status flag is true", async () => {
    const featureWt = makeWorktree({ branch: "feature/auth", path: "/repo-feature-auth" });
    const featureStatus = makeStatus({ branch: "feature/auth", path: "/repo-feature-auth" });

    let readAllSessionsCalled = false;
    const deps = makeListDeps({
      listWorktrees: async () => [featureWt],
      getWorktreeStatuses: async () => [featureStatus],
      getLastCommit: async () => makeCommitInfo(),
      readAllSessions: async () => {
        readAllSessionsCalled = true;
        return {
          "/repo-feature-auth": {
            mode: "pane" as const,
            paneId: 42,
            startedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
          },
        };
      },
      listWeztermPanes: async () => [{ pane_id: 42, title: "claude", cwd: "/tmp" }],
    });

    const result = await executeList({ json: false, verbose: false, status: true }, deps);

    expect(readAllSessionsCalled).toBe(true);
    expect(result.entries[0].session).toBeDefined();
    expect(result.entries[0].session?.status).toBe("running");
  });

  test("session is undefined when no session exists for worktree", async () => {
    const featureWt = makeWorktree({ branch: "feature/x", path: "/repo-feature-x" });
    const featureStatus = makeStatus({ branch: "feature/x", path: "/repo-feature-x" });

    const deps = makeListDeps({
      listWorktrees: async () => [featureWt],
      getWorktreeStatuses: async () => [featureStatus],
      getLastCommit: async () => makeCommitInfo(),
      readAllSessions: async () => ({}),
    });

    const result = await executeList({ json: false, verbose: false, status: true }, deps);

    expect(result.entries[0].session).toBeUndefined();
  });

  test("JSON output includes session when status flag is true", async () => {
    const featureWt = makeWorktree({ branch: "feature/auth", path: "/repo-feature-auth" });
    const featureStatus = makeStatus({ branch: "feature/auth", path: "/repo-feature-auth" });

    let jsonOutput = "";
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      jsonOutput += msg;
    });

    const deps = makeListDeps({
      listWorktrees: async () => [featureWt],
      getWorktreeStatuses: async () => [featureStatus],
      getLastCommit: async () => makeCommitInfo(),
      readAllSessions: async () => ({
        "/repo-feature-auth": {
          mode: "terminal" as const,
          startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
          completedAt: new Date().toISOString(),
        },
      }),
    });

    await executeList({ json: true, verbose: false, status: true }, deps);

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.worktrees[0].session).toBeDefined();
    expect(parsed.worktrees[0].session.status).toBe("done");
    expect(parsed.worktrees[0].session.mode).toBe("terminal");
  });

  test("listWeztermPanes is not called when status flag is false", async () => {
    const mainWt = makeWorktree({ isMain: true, branch: "main", path: "/repo" });
    const mainStatus = makeStatus({ isMain: true, branch: "main", path: "/repo" });

    let panesCalled = false;
    const deps = makeListDeps({
      listWorktrees: async () => [mainWt],
      getWorktreeStatuses: async () => [mainStatus],
      getLastCommit: async () => makeCommitInfo(),
      listWeztermPanes: async () => {
        panesCalled = true;
        return null;
      },
    });

    await executeList(defaultArgs, deps);

    expect(panesCalled).toBe(false);
  });
});

// ============================================================================
// formatSessionState tests
// ============================================================================

describe("formatSessionState", () => {
  test("running session with pane", () => {
    const session: SessionState = {
      status: "running",
      elapsedMs: 15 * 60_000,
      mode: "pane",
      paneId: 3,
    };
    const result = formatSessionState(session);
    expect(result).toContain("Running");
    expect(result).toContain("15m");
    expect(result).toContain("pane #3");
  });

  test("done session with pane", () => {
    const session: SessionState = {
      status: "done",
      elapsedMs: 8 * 60_000,
      mode: "pane",
      paneId: 5,
    };
    const result = formatSessionState(session);
    expect(result).toContain("Done");
    expect(result).toContain("8m");
    expect(result).toContain("pane #5");
  });

  test("running session without pane (terminal mode)", () => {
    const session: SessionState = {
      status: "running",
      elapsedMs: 30 * 60_000,
      mode: "terminal",
    };
    const result = formatSessionState(session);
    expect(result).toContain("Running");
    expect(result).toContain("30m");
    expect(result).not.toContain("pane");
  });

  test("done session without pane (terminal mode)", () => {
    const session: SessionState = {
      status: "done",
      elapsedMs: 60 * 60_000,
      mode: "terminal",
    };
    const result = formatSessionState(session);
    expect(result).toContain("Done");
    expect(result).toContain("1h");
    expect(result).not.toContain("pane");
  });
});
