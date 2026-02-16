import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { _resetColorCache } from "./color.ts";
import {
  COLOR_THEMES,
  type ColorTheme,
  createTailUpdater,
  formatDuration,
  formatInfoLine,
  formatTailLine,
  getMaxExpandedLines,
  lerp,
  pickRandomTheme,
  shimmerText,
  smoothstep,
  startSpinner,
  stripAnsi,
} from "./spinner.ts";

function withTTY<T>(isTTY: boolean, fn: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (saved) {
      Object.defineProperty(process.stdout, "isTTY", saved);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    }
  }
}

beforeEach(() => {
  // Ensure color cache is fresh for each test
  _resetColorCache();
});

afterEach(() => {
  vi.useRealTimers();
  _resetColorCache();
  delete process.env.NO_COLOR;
});

describe("startSpinner (non-TTY)", () => {
  test("returns a Spinner without ANSI sequences", () => {
    withTTY(false, () => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...");

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toBe("- Processing...\n");
      expect(output).not.toContain("\x1b");
      spinner.stop();
    });
  });

  test("stop() outputs plain text without ANSI", () => {
    withTTY(false, () => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      startSpinner("Processing...").stop("Done!");

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Done!\n");
      expect(output).not.toContain("\x1b[?25");
    });
  });

  test("fail() outputs plain text without ANSI", () => {
    withTTY(false, () => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      startSpinner("Processing...").fail("Error occurred");

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Error occurred\n");
      expect(output).not.toContain("\x1b[?25");
    });
  });

  test("updateTail() is a no-op", () => {
    withTTY(false, () => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...");
      writeSpy.mockClear();

      spinner.updateTail(["line 1"], 1);
      expect(writeSpy).not.toHaveBeenCalled();
      spinner.stop();
    });
  });

  test("isExpanded() always returns false", () => {
    withTTY(false, () => {
      const spinner = startSpinner("Processing...");
      expect(spinner.isExpanded()).toBe(false);
      spinner.stop();
    });
  });
});

describe("startSpinner", () => {
  let savedIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    savedIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    if (savedIsTTY) {
      Object.defineProperty(process.stdout, "isTTY", savedIsTTY);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    }
  });
  test("hides cursor on start", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...");

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("\x1b[?25l");
    spinner.stop();
  });

  test("stop() clears tail lines and outputs clear sequence", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...");
    spinner.updateTail(["line 1", "line 2", "line 3"], 3);
    writeSpy.mockClear();

    spinner.stop();

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should move cursor up to clear tail lines
    expect(output).toContain("\x1b[3A");
    // Should clear from cursor to end of screen
    expect(output).toContain("\x1b[J");
    // Should NOT contain dimmed tail content
    expect(output).not.toContain("\x1b[90m");
    // Should show cursor
    expect(output).toContain("\x1b[?25h");
  });

  test("fail() clears tail lines and outputs clear sequence", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...");
    spinner.updateTail(["line 1", "line 2"], 2);
    writeSpy.mockClear();

    spinner.fail("Error occurred");

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should move cursor up to clear tail lines
    expect(output).toContain("\x1b[2A");
    // Should clear from cursor to end of screen
    expect(output).toContain("\x1b[J");
    // Should NOT contain dimmed tail content
    expect(output).not.toContain("\x1b[90m");
    // Should show cursor
    expect(output).toContain("\x1b[?25h");
  });

  test("renders info line when timeout is specified", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...", { timeoutSec: 600 });
    writeSpy.mockClear();

    spinner.updateTail(["line 3", "line 4", "line 5"], 5);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should contain the info line with hidden count and timeout
    expect(output).toContain("..+2 more lines");
    expect(output).toContain("timeout 10m");
    spinner.stop();
  });

  test("shows Ctrl+O expand hint when hidden lines exist", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...", { timeoutSec: 600 });
    writeSpy.mockClear();

    spinner.updateTail(["line 3", "line 4", "line 5"], 5);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Ctrl+O to expand");
    spinner.stop();
  });

  test("does not show Ctrl+O expand hint when all lines visible", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...", { timeoutSec: 600 });
    writeSpy.mockClear();

    spinner.updateTail(["line 1", "line 2"], 2);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).not.toContain("Ctrl+O");
    spinner.stop();
  });

  test("renders info line without hidden count when all lines visible", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...", { timeoutSec: 60 });
    writeSpy.mockClear();

    spinner.updateTail(["only line"], 1);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should contain time info without hidden count
    expect(output).toContain("timeout 1m");
    expect(output).not.toContain("more lines");
    spinner.stop();
  });

  test("does not render info line when no timeout", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...");
    writeSpy.mockClear();

    spinner.updateTail(["line"], 1);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).not.toContain("timeout");
    expect(output).not.toContain("more lines");
    spinner.stop();
  });
});

describe("createTailUpdater", () => {
  test("first line triggers immediate flush (leading edge)", () => {
    vi.useFakeTimers();
    const calls: { lines: string[]; totalCount: number; allLines: string[] }[] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, allLines?: string[]) => {
        calls.push({ lines: [...lines], totalCount, allLines: allLines ? [...allLines] : [] });
      },
      isExpanded: () => false,
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("line 1");

    expect(calls).toEqual([{ lines: ["line 1"], totalCount: 1, allLines: ["line 1"] }]);
  });

  test("second line within 1s is throttled and flushed by trailing edge", () => {
    vi.useFakeTimers();
    const calls: { lines: string[]; totalCount: number; allLines: string[] }[] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, allLines?: string[]) => {
        calls.push({ lines: [...lines], totalCount, allLines: allLines ? [...allLines] : [] });
      },
      isExpanded: () => false,
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("line 1"); // immediate flush
    onLine("line 2"); // throttled

    expect(calls.length).toBe(1); // only first line flushed

    vi.advanceTimersByTime(1000);

    expect(calls).toEqual([
      { lines: ["line 1"], totalCount: 1, allLines: ["line 1"] },
      { lines: ["line 1", "line 2"], totalCount: 2, allLines: ["line 1", "line 2"] },
    ]);
  });

  test("keeps only last 3 tail lines but accumulates all lines", () => {
    vi.useFakeTimers();
    const lastCall = { lines: [] as string[], totalCount: 0, allLines: [] as string[] };
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, allLines?: string[]) => {
        lastCall.lines = [...lines];
        lastCall.totalCount = totalCount;
        lastCall.allLines = allLines ? [...allLines] : [];
      },
      isExpanded: () => false,
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("a"); // immediate flush
    onLine("b");
    onLine("c");
    onLine("d");
    onLine("e"); // all throttled

    vi.advanceTimersByTime(1000); // trailing edge fires

    expect(lastCall.lines).toEqual(["c", "d", "e"]);
    expect(lastCall.totalCount).toBe(5);
    expect(lastCall.allLines).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("lines after 1s trigger a new leading edge flush", () => {
    vi.useFakeTimers();
    const calls: { lines: string[]; totalCount: number }[] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, _allLines?: string[]) => {
        calls.push({ lines: [...lines], totalCount });
      },
      isExpanded: () => false,
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("a"); // immediate flush (leading)

    vi.advanceTimersByTime(1000);
    onLine("b"); // 1s elapsed, new leading edge

    expect(calls.length).toBe(2);
    expect(calls[1]).toEqual({ lines: ["a", "b"], totalCount: 2 });
  });

  test("flushes every line immediately when spinner is expanded", () => {
    vi.useFakeTimers();
    const calls: { lines: string[]; totalCount: number }[] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, _allLines?: string[]) => {
        calls.push({ lines: [...lines], totalCount });
      },
      isExpanded: () => true,
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("a");
    onLine("b");
    onLine("c");

    // All 3 lines should flush immediately without waiting
    expect(calls.length).toBe(3);
    expect(calls[0]).toEqual({ lines: ["a"], totalCount: 1 });
    expect(calls[1]).toEqual({ lines: ["a", "b"], totalCount: 2 });
    expect(calls[2]).toEqual({ lines: ["a", "b", "c"], totalCount: 3 });
  });

  test("switches from throttled to real-time when spinner expands mid-stream", () => {
    vi.useFakeTimers();
    let expandedState = false;
    const calls: { lines: string[]; totalCount: number }[] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, _allLines?: string[]) => {
        calls.push({ lines: [...lines], totalCount });
      },
      isExpanded: () => expandedState,
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("a"); // immediate flush (leading edge)
    onLine("b"); // throttled (collapsed)

    expect(calls.length).toBe(1);

    // User expands the spinner
    expandedState = true;
    onLine("c"); // should flush immediately

    expect(calls.length).toBe(2);
    expect(calls[1]).toEqual({ lines: ["a", "b", "c"], totalCount: 3 });
  });

  test("updateTail is safe after spinner.stop (stopped flag)", () => {
    withTTY(true, () => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Testing...");
      spinner.stop();
      writeSpy.mockClear();

      // After stop, updateTail should be a no-op (no writes to stdout)
      spinner.updateTail(["should be ignored"], 1);
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});

function withTerminalRows(rows: number | undefined, fn: () => void) {
  const saved = Object.getOwnPropertyDescriptor(process.stdout, "rows");
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (saved) {
      Object.defineProperty(process.stdout, "rows", saved);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).rows;
    }
  }
}

describe("keyboard handling", () => {
  type StdinMock = { setRawMode: unknown; resume: unknown; pause: unknown; on: unknown; removeListener: unknown };

  function withTTYStdin(fn: (emitKey: (byte: number) => void) => void) {
    const stdin = process.stdin as typeof process.stdin & StdinMock;
    const saved = {
      isTTY: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
      stdoutIsTTY: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
      setRawMode: stdin.setRawMode,
      resume: stdin.resume,
      pause: stdin.pause,
      on: stdin.on,
      removeListener: stdin.removeListener,
    };

    let capturedHandler: ((data: Buffer) => void) | null = null;

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true, writable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
    stdin.setRawMode = () => process.stdin;
    stdin.resume = () => process.stdin;
    stdin.pause = () => process.stdin;
    stdin.on = ((event: string, handler: (data: Buffer) => void) => {
      if (event === "data") capturedHandler = handler;
      return process.stdin;
    }) as typeof stdin.on;
    stdin.removeListener = () => process.stdin;

    try {
      fn((byte: number) => capturedHandler?.(Buffer.from([byte])));
    } finally {
      if (saved.isTTY) {
        Object.defineProperty(process.stdin, "isTTY", saved.isTTY);
      } else {
        Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true, writable: true });
      }
      if (saved.stdoutIsTTY) {
        Object.defineProperty(process.stdout, "isTTY", saved.stdoutIsTTY);
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).isTTY;
      }
      stdin.setRawMode = saved.setRawMode;
      stdin.resume = saved.resume;
      stdin.pause = saved.pause;
      stdin.on = saved.on;
      stdin.removeListener = saved.removeListener;
    }
  }

  test("Ctrl+O toggles to expanded mode showing lines", () => {
    withTTYStdin((emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      spinner.updateTail(["c", "d", "e"], 5, ["a", "b", "c", "d", "e"]);
      writeSpy.mockClear();

      // Press Ctrl+O to expand
      emitKey(0x0f);

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Ctrl+O to collapse");
      // All lines should be printed (5 lines < 80% of default terminal height)
      expect(output).toContain("a");
      expect(output).toContain("b");
      expect(output).toContain("c");

      spinner.stop();
    });
  });

  test("Ctrl+O collapse hides expanded lines and shows tail", () => {
    withTTYStdin((emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      spinner.updateTail(["c", "d", "e"], 5, ["a", "b", "c", "d", "e"]);

      // Expand then collapse
      emitKey(0x0f);
      writeSpy.mockClear();
      emitKey(0x0f);

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Ctrl+O to expand");
      expect(output).not.toContain("Ctrl+O to collapse");

      spinner.stop();
    });
  });

  test("re-expand shows all lines again since collapse clears them", () => {
    withTTYStdin((emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      spinner.updateTail(["c", "d", "e"], 5, ["a", "b", "c", "d", "e"]);

      // Expand (prints all lines)
      emitKey(0x0f);
      // Collapse (clears expanded lines from terminal)
      emitKey(0x0f);
      writeSpy.mockClear();

      // Re-expand — should re-print all lines since collapse cleared them
      emitKey(0x0f);

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      // All lines should be printed again
      expect(output).toContain("    a");
      expect(output).toContain("    b");
      expect(output).toContain("Ctrl+O to collapse");

      spinner.stop();
    });
  });

  test("collapse clears expanded lines from terminal", () => {
    withTTYStdin((emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      spinner.updateTail(["c", "d", "e"], 100, ["a", "b", "c", "d", "e"]);

      // Expand (prints 5 log lines + 1 info line for spinner area)
      emitKey(0x0f);
      writeSpy.mockClear();

      // Collapse
      emitKey(0x0f);

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      // Should move cursor up to cover expanded log lines (5) + spinner info line (1)
      expect(output).toContain("\x1b[6A");
      // Should clear from cursor to end of screen
      expect(output).toContain("\x1b[J");
      // Should show collapsed tail view
      expect(output).toContain("Ctrl+O to expand");

      spinner.stop();
    });
  });

  test("expanded mode limits output to 80% of terminal height", () => {
    withTTYStdin((emitKey) => {
      // Set terminal to 5 rows → max expanded lines = Math.floor(5 * 0.8) = 4
      withTerminalRows(5, () => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const spinner = startSpinner("Processing...", { timeoutSec: 600 });

        const allLines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
        spinner.updateTail(["line-8", "line-9", "line-10"], 10, allLines);
        writeSpy.mockClear();

        // Press Ctrl+O to expand
        emitKey(0x0f);

        const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
        // Should show only last 4 lines (80% of 5 rows)
        expect(output).toContain("line-7");
        expect(output).toContain("line-8");
        expect(output).toContain("line-9");
        expect(output).toContain("line-10");
        // Should NOT show earlier lines
        expect(output).not.toContain("line-5");
        expect(output).not.toContain("line-6");
        // Should show hidden line count in info line
        expect(output).toContain("..+6 more lines");

        spinner.stop();
      });
    });
  });

  test("expanded mode auto-follows new lines within bounded window", () => {
    withTTYStdin((emitKey) => {
      // Set terminal to 5 rows → max expanded lines = 4
      withTerminalRows(5, () => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const spinner = startSpinner("Processing...", { timeoutSec: 600 });

        const allLines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
        spinner.updateTail(["line-8", "line-9", "line-10"], 10, allLines);

        // Expand
        emitKey(0x0f);

        // Add new line while expanded
        allLines.push("line-11");
        writeSpy.mockClear();
        spinner.updateTail(["line-9", "line-10", "line-11"], 11, allLines);

        const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
        // Should show last 4 lines including the new one
        expect(output).toContain("line-8");
        expect(output).toContain("line-9");
        expect(output).toContain("line-10");
        expect(output).toContain("line-11");
        // Earlier lines should be evicted
        expect(output).not.toContain("line-7");

        spinner.stop();
      });
    });
  });

  test("stop() during expanded mode correctly clears all lines", () => {
    withTTYStdin((emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      spinner.updateTail(["c", "d", "e"], 5, ["a", "b", "c", "d", "e"]);

      // Expand (prints 5 log lines)
      emitKey(0x0f);
      writeSpy.mockClear();

      // Stop while expanded
      spinner.stop();

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      // Should move cursor up to cover expanded log lines (5) + spinner info line (1)
      expect(output).toContain("\x1b[6A");
      // Should clear and show final message
      expect(output).toContain("\x1b[J");
      expect(output).toContain("\x1b[?25h");
    });
  });

  test("stop() cleans up keyboard listener", () => {
    withTTYStdin((_emitKey) => {
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      // stop() should not throw even with keyboard listener active
      expect(() => spinner.stop()).not.toThrow();
    });
  });
});

describe("getMaxExpandedLines", () => {
  test("returns 80% of terminal rows", () => {
    withTerminalRows(50, () => {
      expect(getMaxExpandedLines()).toBe(40); // Math.floor(50 * 0.8)
    });
  });

  test("falls back to 24 rows when process.stdout.rows is undefined", () => {
    withTerminalRows(undefined, () => {
      expect(getMaxExpandedLines()).toBe(19); // Math.floor(24 * 0.8)
    });
  });

  test("returns minimum 1 for very small terminal", () => {
    withTerminalRows(1, () => {
      expect(getMaxExpandedLines()).toBe(1); // Math.max(1, Math.floor(1 * 0.8)) = Math.max(1, 0) = 1
    });
  });
});

describe("stripAnsi", () => {
  test("removes color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("removes 256-color codes", () => {
    expect(stripAnsi("\x1b[38;5;196mtext\x1b[0m")).toBe("text");
  });

  test("removes RGB color codes", () => {
    expect(stripAnsi("\x1b[38;2;120;110;170mtext\x1b[0m")).toBe("text");
  });

  test("removes cursor movement codes", () => {
    expect(stripAnsi("\x1b[2Atext\x1b[J")).toBe("text");
  });

  test("removes CSI sequences with ? (cursor hide/show)", () => {
    expect(stripAnsi("\x1b[?25ltext\x1b[?25h")).toBe("text");
  });

  test("removes OSC sequences (BEL terminated)", () => {
    expect(stripAnsi("\x1b]0;window title\x07text")).toBe("text");
  });

  test("removes OSC sequences (ST terminated)", () => {
    expect(stripAnsi("\x1b]0;window title\x1b\\text")).toBe("text");
  });

  test("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("formatTailLine", () => {
  test("returns line unchanged if within maxWidth", () => {
    expect(formatTailLine("short line", 80)).toBe("short line");
  });

  test("truncates line exceeding maxWidth", () => {
    const long = "a".repeat(100);
    const result = formatTailLine(long, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("…")).toBe(true);
  });

  test("strips ANSI before truncating", () => {
    const colored = `\x1b[31m${"a".repeat(100)}\x1b[0m`;
    const result = formatTailLine(colored, 50);
    expect(result.length).toBe(50);
    expect(result).not.toContain("\x1b");
  });

  test("returns exact maxWidth string unchanged", () => {
    const exact = "a".repeat(50);
    expect(formatTailLine(exact, 50)).toBe(exact);
  });

  test("clamps maxWidth to 1 when 0 or negative", () => {
    expect(formatTailLine("hello", 0)).toBe("…");
    expect(formatTailLine("hello", -5)).toBe("…");
  });

  test("returns ellipsis when maxWidth is 1", () => {
    expect(formatTailLine("hello", 1)).toBe("…");
  });
});

describe("lerp", () => {
  test("returns a when t=0", () => {
    expect(lerp(0, 100, 0)).toBe(0);
  });

  test("returns b when t=1", () => {
    expect(lerp(0, 100, 1)).toBe(100);
  });

  test("returns midpoint when t=0.5", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });
});

describe("smoothstep", () => {
  test("returns 0 when t=0", () => {
    expect(smoothstep(0)).toBe(0);
  });

  test("returns 1 when t=1", () => {
    expect(smoothstep(1)).toBe(1);
  });

  test("returns 0.5 when t=0.5", () => {
    expect(smoothstep(0.5)).toBe(0.5);
  });

  test("returns value less than t for 0 < t < 0.5 (ease-in)", () => {
    const t = 0.25;
    expect(smoothstep(t)).toBeLessThan(t);
  });

  test("returns value greater than t for 0.5 < t < 1 (ease-out)", () => {
    const t = 0.75;
    expect(smoothstep(t)).toBeGreaterThan(t);
  });
});

describe("formatDuration", () => {
  test("formats seconds under 60 as Xs", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(5)).toBe("5s");
    expect(formatDuration(59)).toBe("59s");
  });

  test("formats 60+ seconds as Xm", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(600)).toBe("10m");
  });

  test("floors minutes for non-exact values", () => {
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(119)).toBe("1m");
  });
});

describe("formatInfoLine", () => {
  test("shows hidden count when > 0", () => {
    expect(formatInfoLine(4, 10, 600)).toBe("..+4 more lines (10s · timeout 10m)");
  });

  test("omits hidden count when 0", () => {
    expect(formatInfoLine(0, 5, 600)).toBe("(5s · timeout 10m)");
  });

  test("omits timeout when undefined", () => {
    expect(formatInfoLine(3, 10)).toBe("..+3 more lines (10s)");
  });

  test("omits both hidden count and timeout", () => {
    expect(formatInfoLine(0, 30)).toBe("(30s)");
  });

  test("formats minutes correctly", () => {
    expect(formatInfoLine(10, 120, 600)).toBe("..+10 more lines (2m · timeout 10m)");
  });
});

describe("shimmerText", () => {
  test("returns plain text when color is disabled", () => {
    process.env.NO_COLOR = "1";
    _resetColorCache();
    const result = shimmerText("hello", 2);
    expect(result).toBe("hello");
  });

  test("returns string containing ANSI color codes when color is enabled", () => {
    const saved = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
    try {
      delete process.env.NO_COLOR;
      _resetColorCache();
      const result = shimmerText("hello", 2);
      expect(result).toContain("\x1b[38;2;");
      expect(result).toContain("\x1b[0m");
    } finally {
      if (saved) {
        Object.defineProperty(process.stdout, "isTTY", saved);
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).isTTY;
      }
    }
  });

  test("contains all characters of original text", () => {
    const result = shimmerText("ABC", 1);
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });

  test("works with CJK text", () => {
    const result = shimmerText("Processing", 1);
    expect(result).toContain("P");
    expect(result).toContain("r");
    expect(result).toContain("o");
  });

  test("all chars become base color when shimmerPos is far away (default)", () => {
    const saved = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
    try {
      delete process.env.NO_COLOR;
      _resetColorCache();
      const result = shimmerText("AB", 100);
      // Default base color (120, 110, 170)
      const baseColorCode = "\x1b[38;2;120;110;170m";
      const count = result.split(baseColorCode).length - 1;
      expect(count).toBe(2);
    } finally {
      if (saved) {
        Object.defineProperty(process.stdout, "isTTY", saved);
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).isTTY;
      }
    }
  });

  test("uses provided theme colors", () => {
    const saved = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
    try {
      delete process.env.NO_COLOR;
      _resetColorCache();
      const theme: ColorTheme = {
        base: { r: 80, g: 160, b: 100 },
        bright: { r: 180, g: 255, b: 200 },
      };
      const result = shimmerText("AB", 100, theme);
      const baseColorCode = "\x1b[38;2;80;160;100m";
      const count = result.split(baseColorCode).length - 1;
      expect(count).toBe(2);
    } finally {
      if (saved) {
        Object.defineProperty(process.stdout, "isTTY", saved);
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).isTTY;
      }
    }
  });
});

describe("pickRandomTheme", () => {
  test("returns a theme from COLOR_THEMES", () => {
    const theme = pickRandomTheme();
    expect(COLOR_THEMES).toContainEqual(theme);
  });
});

describe("COLOR_THEMES", () => {
  test("has at least 2 themes", () => {
    expect(COLOR_THEMES.length).toBeGreaterThanOrEqual(2);
  });

  test("all themes have valid RGB values (0-255)", () => {
    for (const theme of COLOR_THEMES) {
      for (const color of [theme.base, theme.bright]) {
        expect(color.r).toBeGreaterThanOrEqual(0);
        expect(color.r).toBeLessThanOrEqual(255);
        expect(color.g).toBeGreaterThanOrEqual(0);
        expect(color.g).toBeLessThanOrEqual(255);
        expect(color.b).toBeGreaterThanOrEqual(0);
        expect(color.b).toBeLessThanOrEqual(255);
      }
    }
  });
});
