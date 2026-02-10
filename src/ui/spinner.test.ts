import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createTailUpdater,
  formatDuration,
  formatInfoLine,
  formatTailLine,
  lerp,
  shimmerText,
  smoothstep,
  startSpinner,
  stripAnsi,
} from "./spinner.ts";

afterEach(() => vi.restoreAllMocks());

describe("startSpinner", () => {
  test("returns a Spinner object", () => {
    const spinner = startSpinner("Testing...");
    expect(spinner).toHaveProperty("stop");
    expect(spinner).toHaveProperty("fail");
    expect(spinner).toHaveProperty("updateTail");
    expect(typeof spinner.stop).toBe("function");
    expect(typeof spinner.fail).toBe("function");
    expect(typeof spinner.updateTail).toBe("function");
    spinner.stop();
  });

  test("stop() can be called normally", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.stop()).not.toThrow();
  });

  test("stop() accepts a message", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.stop("Completed")).not.toThrow();
  });

  test("fail() can be called normally", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.fail("An error occurred")).not.toThrow();
  });

  test("updateTail() can be called normally", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.updateTail(["line 1", "line 2"], 2)).not.toThrow();
    spinner.stop();
  });

  test("updateTail() with empty array", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.updateTail([], 0)).not.toThrow();
    spinner.stop();
  });

  test("updateTail() accepts allLines parameter", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.updateTail(["line 3"], 3, ["line 1", "line 2", "line 3"])).not.toThrow();
    spinner.stop();
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
  test("feeds lines to spinner.updateTail with totalCount and allLines", () => {
    const calls: { lines: string[]; totalCount: number; allLines: string[] }[] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, allLines?: string[]) => {
        calls.push({ lines: [...lines], totalCount, allLines: allLines ? [...allLines] : [] });
      },
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("line 1");
    onLine("line 2");

    expect(calls).toEqual([
      { lines: ["line 1"], totalCount: 1, allLines: ["line 1"] },
      { lines: ["line 1", "line 2"], totalCount: 2, allLines: ["line 1", "line 2"] },
    ]);
  });

  test("keeps only last 3 tail lines but accumulates all lines", () => {
    const lastCall = { lines: [] as string[], totalCount: 0, allLines: [] as string[] };
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[], totalCount: number, allLines?: string[]) => {
        lastCall.lines = [...lines];
        lastCall.totalCount = totalCount;
        lastCall.allLines = allLines ? [...allLines] : [];
      },
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("a");
    onLine("b");
    onLine("c");
    onLine("d");
    onLine("e");

    expect(lastCall.lines).toEqual(["c", "d", "e"]);
    expect(lastCall.totalCount).toBe(5);
    expect(lastCall.allLines).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("keyboard handling", () => {
  type StdinMock = { setRawMode: unknown; resume: unknown; pause: unknown; on: unknown; removeListener: unknown };

  function withTTYStdin(fn: (emitKey: (byte: number) => void) => void) {
    const stdin = process.stdin as typeof process.stdin & StdinMock;
    const saved = {
      isTTY: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
      setRawMode: stdin.setRawMode,
      resume: stdin.resume,
      pause: stdin.pause,
      on: stdin.on,
      removeListener: stdin.removeListener,
    };

    let capturedHandler: ((data: Buffer) => void) | null = null;

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true, writable: true });
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
      stdin.setRawMode = saved.setRawMode;
      stdin.resume = saved.resume;
      stdin.pause = saved.pause;
      stdin.on = saved.on;
      stdin.removeListener = saved.removeListener;
    }
  }

  test("Ctrl+O toggles to expanded mode showing all lines", () => {
    withTTYStdin((emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      spinner.updateTail(["c", "d", "e"], 5, ["a", "b", "c", "d", "e"]);
      writeSpy.mockClear();

      // Press Ctrl+O to expand
      emitKey(0x0f);

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Ctrl+O to collapse");
      // All lines should be printed permanently
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

  test("stop() cleans up keyboard listener", () => {
    withTTYStdin((_emitKey) => {
      const spinner = startSpinner("Processing...", { timeoutSec: 600 });

      // stop() should not throw even with keyboard listener active
      expect(() => spinner.stop()).not.toThrow();
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
  test("returns string containing ANSI color codes", () => {
    const result = shimmerText("hello", 2);
    expect(result).toContain("\x1b[38;2;");
    expect(result).toContain("\x1b[0m");
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

  test("all chars become base color when shimmerPos is far away", () => {
    const result = shimmerText("AB", 100);
    // Both chars should be base color (120, 110, 170)
    const baseColorCode = "\x1b[38;2;120;110;170m";
    const count = result.split(baseColorCode).length - 1;
    expect(count).toBe(2);
  });
});
