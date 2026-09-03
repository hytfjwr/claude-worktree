import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../ui/icons.ts", () => ({
  icons: {
    bullet: () => "•",
    lock: () => "🔒",
    success: () => "✓",
    warning: () => "!",
    active: () => "●",
  },
}));

import { makeCommitInfo, makeStatus, saveEnv, withTTY } from "../__test-utils__.ts";
import { stringWidth } from "../core/width.ts";
import type { ListArgs, ListDeps, ListWatchIo, WorktreeListEntry } from "../types/index.ts";
import { _resetColorCache } from "../ui/color.ts";
import {
  createDefaultWatchIo,
  executeListWatch,
  formatClockTime,
  parseWatchKey,
  renderWatchFrame,
} from "./list-watch.ts";

function makeListEntry(branch: string, path: string, overrides: Partial<WorktreeListEntry> = {}): WorktreeListEntry {
  const status = makeStatus({ branch, path });
  return { worktree: status.worktree, status, commit: makeCommitInfo(), aheadBehind: null, ...overrides };
}

const noopSpinner = (_message: string) => ({
  stop: (_finalMessage?: string) => {},
  fail: (_message: string) => {},
  updateTail: (_lines: string[]) => {},
  isExpanded: () => false,
});

function makeListDeps(overrides: Partial<ListDeps> = {}): ListDeps {
  return {
    getRemoteTrackingBranches: async () => new Set<string>(),
    getRemoteBranches: async () => new Set<string>(),
    fetchAndPrune: async () => {},
    listWorktrees: async () => ({ worktrees: [], mainBranch: "main" }),
    getWorktreeStatuses: async () => [],
    getLastCommit: async () => makeCommitInfo(),
    getAheadBehind: async () => null,
    startSpinner: noopSpinner,
    readAllSessions: async () => ({}),
    listWeztermPanes: async () => null,
    listTmuxPanes: async () => null,
    listHerdrPanes: async () => null,
    gcMissingSessions: async () => 0,
    gcMissingSlots: async () => 0,
    ...overrides,
  };
}

const watchArgs: ListArgs = {
  json: false,
  verbose: false,
  noStatus: true,
  quiet: false,
  fetch: false,
  watch: true,
  intervalSeconds: 2,
};

/** Lets every immediately-resolvable promise chain settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeFakeIo(overrides: Partial<ListWatchIo> = {}) {
  const writes: string[] = [];
  const keyListeners: ((data: Buffer) => void)[] = [];
  const resizeListeners: (() => void)[] = [];
  const exitListeners: (() => void)[] = [];
  const intervals: { callback: () => void; ms: number }[] = [];
  const state = {
    rawMode: false,
    exitCode: null as number | null,
    keyUnsubscribed: 0,
    resizeUnsubscribed: 0,
    exitUnsubscribed: 0,
    intervalCancelled: 0,
  };
  const io: ListWatchIo = {
    write: (chunk) => {
      writes.push(chunk);
    },
    rows: () => 40,
    columns: () => 120,
    now: () => new Date("2025-01-15T12:00:00Z"),
    setRawMode: (enabled) => {
      state.rawMode = enabled;
    },
    onKey: (listener) => {
      keyListeners.push(listener);
      return () => {
        state.keyUnsubscribed++;
      };
    },
    onResize: (listener) => {
      resizeListeners.push(listener);
      return () => {
        state.resizeUnsubscribed++;
      };
    },
    onExit: (listener) => {
      exitListeners.push(listener);
      return () => {
        state.exitUnsubscribed++;
      };
    },
    setInterval: (callback, ms) => {
      intervals.push({ callback, ms });
      return () => {
        state.intervalCancelled++;
      };
    },
    exit: (code) => {
      state.exitCode = code;
    },
    ...overrides,
  };
  return { io, writes, keyListeners, resizeListeners, exitListeners, intervals, state };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("formatClockTime", () => {
  test("returns local time zero-padded to two digits", () => {
    expect(formatClockTime(new Date(2025, 0, 15, 9, 5, 3))).toBe("09:05:03");
  });

  test("midnight", () => {
    expect(formatClockTime(new Date(2025, 0, 15, 0, 0, 0))).toBe("00:00:00");
  });
});

describe("parseWatchKey", () => {
  test("q is quit", () => {
    expect(parseWatchKey(Buffer.from([0x71]))).toBe("quit");
  });

  test("Esc is quit", () => {
    expect(parseWatchKey(Buffer.from([0x1b]))).toBe("quit");
  });

  test("Ctrl+C is interrupt", () => {
    expect(parseWatchKey(Buffer.from([0x03]))).toBe("interrupt");
  });

  test("r is refresh", () => {
    expect(parseWatchKey(Buffer.from([0x72]))).toBe("refresh");
  });

  test("arrow key escape sequence is not treated as a bare Esc", () => {
    expect(parseWatchKey(Buffer.from([0x1b, 0x5b, 0x41]))).toBe("unknown");
  });

  test("unrecognized byte is unknown", () => {
    expect(parseWatchKey(Buffer.from([0x78]))).toBe("unknown");
  });
});

describe("renderWatchFrame", () => {
  const args: ListArgs = { json: false, verbose: false, noStatus: true, quiet: false, fetch: false };
  const defaultMeta = { updatedAt: new Date(2025, 0, 15, 12, 34, 56), refreshing: false };

  test("normal display shows entries, header and footer", () => {
    const entries = [makeListEntry("feature/a", "/tmp/repo-a"), makeListEntry("feature/b", "/tmp/repo-b")];
    const frame = renderWatchFrame(entries, "/tmp", args, 40, 120, defaultMeta);
    expect(frame).toContain("Worktrees (2)");
    expect(frame).toContain("updated 12:34:56");
    expect(frame).toContain("feature/a");
    expect(frame).toContain("feature/b");
    expect(frame).toContain("Summary: 2 worktrees");
    expect(frame).toContain("r refresh");
    expect(frame).toContain("q/Esc/Ctrl+C quit");
  });

  test("initial load shows loading indicators and no summary", () => {
    const frame = renderWatchFrame([], "/tmp", args, 40, 120, { updatedAt: null, refreshing: false });
    expect(frame).toContain("loading…");
    expect(frame).toContain("Loading worktrees…");
    expect(frame).not.toContain("Summary:");
  });

  test("zero worktrees shows the empty message and no summary", () => {
    const frame = renderWatchFrame([], "/tmp", args, 40, 120, defaultMeta);
    expect(frame).toContain("No worktrees found.");
    expect(frame).not.toContain("Summary:");
  });

  test("refreshing indicator appears only while refreshing", () => {
    const entries = [makeListEntry("feature/a", "/tmp/repo-a")];
    const refreshingFrame = renderWatchFrame(entries, "/tmp", args, 40, 120, { ...defaultMeta, refreshing: true });
    const idleFrame = renderWatchFrame(entries, "/tmp", args, 40, 120, { ...defaultMeta, refreshing: false });
    expect(refreshingFrame).toContain("refreshing…");
    expect(idleFrame).not.toContain("refreshing…");
  });

  test("truncates entries that do not fit the terminal height", () => {
    const entries = Array.from({ length: 8 }, (_, i) => makeListEntry(`feature/${i}`, `/tmp/repo-${i}`));
    const frame = renderWatchFrame(entries, "/tmp", args, 16, 120, defaultMeta);
    expect(frame.split("\n").length).toBeLessThanOrEqual(16);
    expect(frame).toContain("… and 6 more");
    expect(frame).toContain("feature/0");
    expect(frame).toContain("feature/1");
    expect(frame).not.toContain("feature/7");
  });

  test("very short terminal still bounds output height", () => {
    const entries = Array.from({ length: 3 }, (_, i) => makeListEntry(`feature/${i}`, `/tmp/repo-${i}`));
    const frame = renderWatchFrame(entries, "/tmp", args, 5, 120, defaultMeta);
    expect(frame.split("\n").length).toBeLessThanOrEqual(5);
    expect(frame).toContain("… and 3 more");
  });

  test("error line does not push output past the row budget", () => {
    const entries = Array.from({ length: 8 }, (_, i) => makeListEntry(`feature/${i}`, `/tmp/repo-${i}`));
    const frame = renderWatchFrame(entries, "/tmp", args, 16, 120, { ...defaultMeta, error: "git exploded" });
    expect(frame.split("\n").length).toBeLessThanOrEqual(16);
  });

  test("truncates lines wider than the terminal columns", () => {
    const entries = Array.from({ length: 3 }, (_, i) => makeListEntry(`feature/${i}`, `/tmp/repo-${i}`));
    const frame = renderWatchFrame(entries, "/tmp", args, 40, 20, defaultMeta);
    for (const line of frame.split("\n")) {
      expect(stringWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  test("shows the error line above the footer", () => {
    const entries = [makeListEntry("feature/a", "/tmp/repo-a")];
    const frame = renderWatchFrame(entries, "/tmp", args, 40, 120, { ...defaultMeta, error: "git exploded" });
    expect(frame).toContain("Update failed: git exploded");
    expect(frame).toContain("r refresh");
  });

  test("NO_COLOR disables ANSI escapes", () => {
    const restore = saveEnv("NO_COLOR");
    try {
      process.env.NO_COLOR = "1";
      _resetColorCache();
      const entries = [makeListEntry("feature/a", "/tmp/repo-a")];
      const frame = renderWatchFrame(entries, "/tmp", args, 40, 120, defaultMeta);
      expect(frame).not.toContain("\x1b[");
    } finally {
      restore();
      _resetColorCache();
    }
  });

  test("color is applied when enabled", () => {
    const restore = saveEnv("NO_COLOR");
    try {
      delete process.env.NO_COLOR;
      withTTY(true, () => {
        _resetColorCache();
        const entries = [makeListEntry("feature/a", "/tmp/repo-a")];
        const frame = renderWatchFrame(entries, "/tmp", args, 40, 120, defaultMeta);
        expect(frame).toContain("\x1b[");
      });
    } finally {
      restore();
      _resetColorCache();
    }
  });
});

describe("executeListWatch", () => {
  test("enters the alternate screen and hides the cursor on start", async () => {
    const { io, writes, state, keyListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, makeListDeps(), io);
    await flush();
    expect(writes[0]).toContain("\x1b[?1049h");
    expect(writes[0]).toContain("\x1b[?25l");
    expect(state.rawMode).toBe(true);
    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("q cleans up the terminal and resolves", async () => {
    const { io, writes, state, keyListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, makeListDeps(), io);
    await flush();
    keyListeners[0](Buffer.from([0x71]));
    await promise;
    const lastWrite = writes[writes.length - 1];
    expect(lastWrite).toContain("\x1b[?25h");
    expect(lastWrite).toContain("\x1b[?1049l");
    expect(state.rawMode).toBe(false);
    expect(state.keyUnsubscribed).toBe(1);
    expect(state.resizeUnsubscribed).toBe(1);
    expect(state.exitUnsubscribed).toBe(1);
    expect(state.intervalCancelled).toBe(1);
    expect(state.exitCode).toBe(null);
  });

  test("Esc quits without an exit code", async () => {
    const { io, writes, state, keyListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, makeListDeps(), io);
    await flush();
    keyListeners[0](Buffer.from([0x1b]));
    await promise;
    const lastWrite = writes[writes.length - 1];
    expect(lastWrite).toContain("\x1b[?25h");
    expect(lastWrite).toContain("\x1b[?1049l");
    expect(state.exitCode).toBe(null);
  });

  test("Ctrl+C exits with code 130 and still cleans up", async () => {
    const { io, writes, state, keyListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, makeListDeps(), io);
    await flush();
    keyListeners[0](Buffer.from([0x03]));
    await promise;
    expect(state.exitCode).toBe(130);
    const lastWrite = writes[writes.length - 1];
    expect(lastWrite).toContain("\x1b[?25h");
    expect(lastWrite).toContain("\x1b[?1049l");
    expect(state.rawMode).toBe(false);
    expect(state.keyUnsubscribed).toBe(1);
    expect(state.resizeUnsubscribed).toBe(1);
    expect(state.exitUnsubscribed).toBe(1);
  });

  test("-fetch only applies on the first refresh", async () => {
    let fetchCalls = 0;
    const deps = makeListDeps({
      fetchAndPrune: async () => {
        fetchCalls++;
      },
    });
    const { io, keyListeners, intervals } = makeFakeIo();
    const promise = executeListWatch({ ...watchArgs, fetch: true }, deps, io);
    await flush();
    intervals[0].callback();
    intervals[0].callback();
    await flush();
    expect(fetchCalls).toBe(1);
    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("prevents overlapping refreshes", async () => {
    // A plain `let` reassigned only inside the nested Promise executor gets
    // over-narrowed to `never` at the use site below, so hold it in an object instead.
    const deferred: { resolve: (() => void) | null } = { resolve: null };
    let listWorktreesCalls = 0;
    const deps = makeListDeps({
      listWorktrees: () =>
        new Promise((resolve) => {
          listWorktreesCalls++;
          deferred.resolve = () => resolve({ worktrees: [], mainBranch: "main" });
        }),
    });
    const { io, keyListeners, intervals } = makeFakeIo();
    const promise = executeListWatch(watchArgs, deps, io);
    await flush();
    // First refresh (triggered by startup) is still in-flight.
    intervals[0].callback();
    await flush();
    expect(listWorktreesCalls).toBe(1);

    deferred.resolve?.();
    await flush();
    intervals[0].callback();
    await flush();
    expect(listWorktreesCalls).toBe(2);

    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("a refresh that lands after quitting does not draw over the restored terminal", async () => {
    const deferred: { resolve: (() => void) | null } = { resolve: null };
    const deps = makeListDeps({
      listWorktrees: () =>
        new Promise((resolve) => {
          deferred.resolve = () => resolve({ worktrees: [], mainBranch: "main" });
        }),
    });
    const { io, writes, keyListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, deps, io);
    await flush();
    // Quit while the first refresh is still in-flight.
    keyListeners[0](Buffer.from([0x71]));
    await promise;
    const writeCountAfterQuit = writes.length;
    const lastWrite = writes[writes.length - 1];

    deferred.resolve?.();
    await flush();

    expect(writes.length).toBe(writeCountAfterQuit);
    expect(writes[writes.length - 1]).toBe(lastWrite);
    expect(lastWrite).toContain("\x1b[?1049l");
  });

  test("skips writing when the redrawn frame is unchanged", async () => {
    const { io, writes, keyListeners, intervals } = makeFakeIo();
    const promise = executeListWatch(watchArgs, makeListDeps(), io);
    await flush();
    const writeCountAfterLoad = writes.length;
    intervals[0].callback();
    await flush();
    expect(writes.length).toBe(writeCountAfterLoad);
    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("r triggers an immediate refresh", async () => {
    let listWorktreesCalls = 0;
    const deps = makeListDeps({
      listWorktrees: async () => {
        listWorktreesCalls++;
        return { worktrees: [], mainBranch: "main" };
      },
    });
    const { io, keyListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, deps, io);
    await flush();
    keyListeners[0](Buffer.from([0x72]));
    await flush();
    expect(listWorktreesCalls).toBe(2);
    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("an error during refresh is shown but does not kill the loop", async () => {
    let listWorktreesCalls = 0;
    const deps = makeListDeps({
      listWorktrees: async () => {
        listWorktreesCalls++;
        if (listWorktreesCalls === 2) {
          throw new Error("git exploded");
        }
        return { worktrees: [], mainBranch: "main" };
      },
    });
    const { io, writes, keyListeners, intervals } = makeFakeIo();
    const promise = executeListWatch(watchArgs, deps, io);
    await flush();

    intervals[0].callback();
    await flush();
    expect(writes[writes.length - 1]).toContain("Update failed:");

    intervals[0].callback();
    await flush();
    expect(writes[writes.length - 1]).not.toContain("Update failed:");

    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("resize triggers a redraw", async () => {
    const { io, writes, keyListeners, resizeListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, makeListDeps(), io);
    await flush();
    const writeCountBeforeResize = writes.length;
    resizeListeners[0]();
    expect(writes.length).toBeGreaterThan(writeCountBeforeResize);
    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("the abnormal-exit handler restores the terminal", async () => {
    const { io, writes, exitListeners, keyListeners } = makeFakeIo();
    const promise = executeListWatch(watchArgs, makeListDeps(), io);
    await flush();
    exitListeners[0]();
    expect(writes[writes.length - 1]).toContain("\x1b[?25h");
    expect(writes[writes.length - 1]).toContain("\x1b[?1049l");
    keyListeners[0](Buffer.from([0x71]));
    await promise;
  });

  test("the interval duration is derived from intervalSeconds", async () => {
    const { io: io1, keyListeners: keys1, intervals: intervals1 } = makeFakeIo();
    const promise1 = executeListWatch({ ...watchArgs, intervalSeconds: 5 }, makeListDeps(), io1);
    await flush();
    expect(intervals1[0].ms).toBe(5000);
    keys1[0](Buffer.from([0x71]));
    await promise1;

    const { io: io2, keyListeners: keys2, intervals: intervals2 } = makeFakeIo();
    const promise2 = executeListWatch({ ...watchArgs, intervalSeconds: undefined }, makeListDeps(), io2);
    await flush();
    expect(intervals2[0].ms).toBe(2000);
    keys2[0](Buffer.from([0x71]));
    await promise2;
  });
});

describe("createDefaultWatchIo", () => {
  test("falls back to sane dimensions when the terminal reports zero", () => {
    const saved = ["rows", "columns"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(process.stdout, key)] as const,
    );
    for (const [key] of saved) {
      Object.defineProperty(process.stdout, key, { value: 0, configurable: true, writable: true });
    }
    try {
      const io = createDefaultWatchIo();
      expect(io.rows()).toBe(24);
      expect(io.columns()).toBe(80);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) {
          Object.defineProperty(process.stdout, key, descriptor);
        } else {
          delete (process.stdout as unknown as Record<string, unknown>)[key];
        }
      }
    }
  });
});
