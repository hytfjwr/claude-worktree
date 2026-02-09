import { describe, expect, test, spyOn } from "bun:test";
import { createTailUpdater, formatTailLine, lerp, shimmerText, smoothstep, startSpinner, stripAnsi } from "./spinner";

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
    expect(() => spinner.updateTail(["line 1", "line 2"])).not.toThrow();
    spinner.stop();
  });

  test("updateTail() with empty array", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.updateTail([])).not.toThrow();
    spinner.stop();
  });

  test("stop() clears tail lines and outputs clear sequence", () => {
    const writeSpy = spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...");
    spinner.updateTail(["line 1", "line 2", "line 3"]);
    writeSpy.mockClear();

    spinner.stop();

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should move cursor up to clear tail lines
    expect(output).toContain("\x1b[3A");
    // Should clear from cursor to end of screen
    expect(output).toContain("\x1b[J");
    // Should NOT contain dimmed tail content
    expect(output).not.toContain("\x1b[90m");
    writeSpy.mockRestore();
  });

  test("fail() clears tail lines and outputs clear sequence", () => {
    const writeSpy = spyOn(process.stdout, "write");
    const spinner = startSpinner("Processing...");
    spinner.updateTail(["line 1", "line 2"]);
    writeSpy.mockClear();

    spinner.fail("Error occurred");

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should move cursor up to clear tail lines
    expect(output).toContain("\x1b[2A");
    // Should clear from cursor to end of screen
    expect(output).toContain("\x1b[J");
    // Should NOT contain dimmed tail content
    expect(output).not.toContain("\x1b[90m");
    writeSpy.mockRestore();
  });
});

describe("createTailUpdater", () => {
  test("feeds lines to spinner.updateTail", () => {
    const calls: string[][] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[]) => { calls.push([...lines]); },
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("line 1");
    onLine("line 2");

    expect(calls).toEqual([["line 1"], ["line 1", "line 2"]]);
  });

  test("keeps only last 3 lines", () => {
    const lastCall: string[] = [];
    const mockSpinner = {
      stop: () => {},
      fail: () => {},
      updateTail: (lines: string[]) => { lastCall.length = 0; lastCall.push(...lines); },
    };

    const onLine = createTailUpdater(mockSpinner);
    onLine("a");
    onLine("b");
    onLine("c");
    onLine("d");

    expect(lastCall).toEqual(["b", "c", "d"]);
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
    const colored = "\x1b[31m" + "a".repeat(100) + "\x1b[0m";
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
