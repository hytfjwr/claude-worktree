import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { saveEnv } from "../__test-utils__.ts";
import { stringWidth, stripAnsi } from "../core/width.ts";
import { _resetColorCache, styles } from "./color.ts";
import { computeViewport, computeViewportHeight, filterItems, fuzzyMatch, selectMany, selectSingle } from "./select.ts";

// Mock readline for non-TTY fallback tests.
// TTY tests bypass this because they enter the raw-mode path.
let mockRlAnswer = "";
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: (answer: string) => void) => cb(mockRlAnswer),
    close: () => {},
  }),
}));

// =============================================================================
// Test helpers
// =============================================================================

type StdinMock = {
  setRawMode: unknown;
  resume: unknown;
  pause: unknown;
  on: unknown;
  removeListener: unknown;
};

/**
 * withTTYStdin sets up stdin/stdout as TTY, captures the "data" handler,
 * and returns an emitKey helper to simulate key presses. `dims` overrides
 * process.stdout.rows/columns for the duration of the callback (defaults to
 * 24x100 so tests are not sensitive to the real terminal size).
 */
function withTTYStdin<T>(fn: (emitKey: (bytes: number[]) => void) => T, dims?: { rows?: number; columns?: number }): T {
  const stdin = process.stdin as typeof process.stdin & StdinMock;
  const saved = {
    stdinIsTTY: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
    stdoutIsTTY: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
    stdoutRows: Object.getOwnPropertyDescriptor(process.stdout, "rows"),
    stdoutColumns: Object.getOwnPropertyDescriptor(process.stdout, "columns"),
    setRawMode: stdin.setRawMode,
    resume: stdin.resume,
    pause: stdin.pause,
    on: stdin.on,
    removeListener: stdin.removeListener,
  };

  let capturedHandler: ((data: Buffer) => void) | null = null;

  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true, writable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
  Object.defineProperty(process.stdout, "rows", { value: dims?.rows ?? 24, configurable: true, writable: true });
  Object.defineProperty(process.stdout, "columns", {
    value: dims?.columns ?? 100,
    configurable: true,
    writable: true,
  });
  stdin.setRawMode = () => process.stdin;
  stdin.resume = () => process.stdin;
  stdin.pause = () => process.stdin;
  stdin.on = ((event: string, handler: (data: Buffer) => void) => {
    if (event === "data") capturedHandler = handler;
    return process.stdin;
  }) as typeof stdin.on;
  stdin.removeListener = (() => process.stdin) as typeof stdin.removeListener;

  const restore = () => {
    if (saved.stdinIsTTY) {
      Object.defineProperty(process.stdin, "isTTY", saved.stdinIsTTY);
    } else {
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true, writable: true });
    }
    if (saved.stdoutIsTTY) {
      Object.defineProperty(process.stdout, "isTTY", saved.stdoutIsTTY);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    }
    if (saved.stdoutRows) {
      Object.defineProperty(process.stdout, "rows", saved.stdoutRows);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).rows;
    }
    if (saved.stdoutColumns) {
      Object.defineProperty(process.stdout, "columns", saved.stdoutColumns);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).columns;
    }
    stdin.setRawMode = saved.setRawMode;
    stdin.resume = saved.resume;
    stdin.pause = saved.pause;
    stdin.on = saved.on;
    stdin.removeListener = saved.removeListener;
  };

  const emitKey = (bytes: number[]) => {
    capturedHandler?.(Buffer.from(bytes));
  };

  try {
    const result = fn(emitKey);
    if (result instanceof Promise) {
      return result.finally(restore) as T;
    }
    restore();
    return result;
  } catch (e) {
    restore();
    throw e;
  }
}

function withNonTTYStdin<T>(fn: () => T): T {
  const savedStdin = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const savedStdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true, writable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (savedStdin) {
      Object.defineProperty(process.stdin, "isTTY", savedStdin);
    } else {
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true, writable: true });
    }
    if (savedStdout) {
      Object.defineProperty(process.stdout, "isTTY", savedStdout);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    }
  }
}

// Key constants
const KEY_ENTER = [0x0d];
const KEY_SPACE = [0x20];
const KEY_UP = [0x1b, 0x5b, 0x41];
const KEY_DOWN = [0x1b, 0x5b, 0x42];
const KEY_Q = [0x71];
const KEY_ESC = [0x1b];
const KEY_J = [0x6a];
const KEY_K = [0x6b];
const KEY_A = [0x61];
const KEY_PAGE_DOWN = [0x1b, 0x5b, 0x36, 0x7e];
const KEY_PAGE_UP = [0x1b, 0x5b, 0x35, 0x7e];
const KEY_HOME_CSI = [0x1b, 0x5b, 0x48];
const KEY_END_CSI = [0x1b, 0x5b, 0x46];
const KEY_G_LOWER = [0x67];
const KEY_G_UPPER = [0x47];
const KEY_CTRL_P = [0x10];
const KEY_CTRL_N = [0x0e];
const KEY_SLASH = [0x2f];
const KEY_BACKSPACE = [0x7f];
const KEY_CTRL_U = [0x15];

/** Emits one key event per byte of `text`, simulating a paste-free keystroke sequence. */
function typeText(emitKey: (bytes: number[]) => void, text: string) {
  for (const byte of Buffer.from(text, "utf8")) emitKey([byte]);
}

const sampleItems = [
  { value: "a", label: "Alpha", description: "/path/alpha" },
  { value: "b", label: "Beta", description: "/path/beta" },
  { value: "c", label: "Gamma", description: "/path/gamma" },
];

// =============================================================================
// Setup / Teardown
// =============================================================================

let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = saveEnv("NO_COLOR");
  _resetColorCache();
});

afterEach(() => {
  restoreEnv();
  _resetColorCache();
});

// =============================================================================
// selectSingle
// =============================================================================

describe("selectSingle", () => {
  test("returns null for empty items", async () => {
    const result = await selectSingle({ message: "Pick:", items: [] });
    expect(result).toBeNull();
  });

  test("renders initial display with first item highlighted", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");

      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Pick:");
      expect(output).toContain("Alpha");
      expect(output).toContain("Beta");
      expect(output).toContain("Gamma");

      // Confirm first item
      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("Enter confirms the current selection", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("a");
    });
  });

  test("arrow down then Enter selects second item", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_DOWN);
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("b");
    });
  });

  test("j/k keys navigate like arrow keys", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_J); // down to Beta
      emitKey(KEY_J); // down to Gamma
      emitKey(KEY_K); // up to Beta
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("b");
    });
  });

  test("arrow up from first item wraps to last", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_UP); // wraps to Gamma
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("c");
    });
  });

  test("arrow down from last item wraps to first", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_DOWN); // Beta
      emitKey(KEY_DOWN); // Gamma
      emitKey(KEY_DOWN); // wraps to Alpha
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("a");
    });
  });

  test("q cancels and returns null", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_Q);
      const result = await promise;
      expect(result).toBeNull();
    });
  });

  test("Esc cancels and returns null", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_ESC);
      const result = await promise;
      expect(result).toBeNull();
    });
  });

  test("hides and shows cursor", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      const beforeOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(beforeOutput).toContain("\x1b[?25l"); // cursor hidden

      emitKey(KEY_ENTER);
      await promise;

      const afterOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(afterOutput).toContain("\x1b[?25h"); // cursor shown
    });
  });

  test("shows footer with navigation hints", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("navigate");
      expect(output).toContain("confirm");
      expect(output).toContain("cancel");

      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("Ctrl+C exits process with code 130", () => {
    return withTTYStdin(async (emitKey) => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      expect(() => emitKey([0x03])).toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(130);

      // The promise will never resolve because we mocked process.exit
      promise.catch(() => {});
    });
  });
});

// =============================================================================
// selectMany
// =============================================================================

describe("selectMany", () => {
  const multiItems = [
    { value: "x", label: "Xray", hint: "merged" },
    { value: "y", label: "Yankee", hint: "remote deleted" },
    { value: "z", label: "Zulu", hint: "both" },
  ];

  test("returns empty array for empty items", async () => {
    const result = await selectMany({ message: "Pick:", items: [] });
    expect(result).toEqual([]);
  });

  test("Space toggles selection on current item", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: multiItems });
      emitKey(KEY_SPACE); // toggle first
      emitKey(KEY_DOWN);
      emitKey(KEY_SPACE); // toggle second
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toEqual(["x", "y"]);
    });
  });

  test("Space toggles off a selected item", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: multiItems });
      emitKey(KEY_SPACE); // select first
      emitKey(KEY_SPACE); // deselect first
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toEqual([]);
    });
  });

  test("'a' selects all items", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: multiItems });
      emitKey(KEY_A); // select all
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toEqual(["x", "y", "z"]);
    });
  });

  test("'a' toggles: select all then deselect all", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: multiItems });
      emitKey(KEY_A); // select all
      emitKey(KEY_A); // deselect all
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toEqual([]);
    });
  });

  test("Enter with no selection returns empty array", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: multiItems });
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toEqual([]);
    });
  });

  test("q cancels and returns empty array", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: multiItems });
      emitKey(KEY_SPACE); // select first
      emitKey(KEY_Q); // cancel
      const result = await promise;
      expect(result).toEqual([]);
    });
  });

  test("renders checked/unchecked indicators and hints", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectMany({ message: "Pick:", items: multiItems });

      // Initial render: all unchecked
      let output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Xray");
      expect(output).toContain("Yankee");
      expect(output).toContain("Zulu");
      // Hints should be rendered
      expect(output).toContain("merged");
      expect(output).toContain("remote deleted");

      // Toggle first item -> should show checked indicator
      emitKey(KEY_SPACE);

      output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      // Checked icon (◼ or [x]) should appear after toggle
      expect(output).toMatch(/◼|\[x\]/);

      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("renders description alongside hint when both are provided", () => {
    const itemsWithDesc = [
      { value: "a", label: "Alpha", description: "/path/alpha", hint: "merged" },
      { value: "b", label: "Beta", description: "/path/beta" },
    ];
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectMany({ message: "Pick:", items: itemsWithDesc });

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      // Both description and hint should be visible
      expect(output).toContain("/path/alpha");
      expect(output).toContain("merged");
      // Description-only item should show path
      expect(output).toContain("/path/beta");

      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("shows multi-select footer with Space/a hints", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectMany({ message: "Pick:", items: multiItems });

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("Space");
      expect(output).toContain("toggle");

      emitKey(KEY_ENTER);
      await promise;
    });
  });
});

// =============================================================================
// Non-TTY fallback
// =============================================================================

describe("non-TTY fallback", () => {
  test("selectSingle falls back to readline when stdin is not TTY", async () => {
    mockRlAnswer = "2";
    const result = await withNonTTYStdin(() => {
      return selectSingle({ message: "Pick:", items: sampleItems });
    });
    expect(result).toBe("b");
  });

  test("selectSingle fallback returns null on empty input", async () => {
    mockRlAnswer = "";
    const result = await withNonTTYStdin(() => {
      return selectSingle({ message: "Pick:", items: sampleItems });
    });
    expect(result).toBeNull();
  });

  test("selectMany falls back to readline when stdin is not TTY", async () => {
    const items = [
      { value: "x", label: "Xray" },
      { value: "y", label: "Yankee" },
      { value: "z", label: "Zulu" },
    ];
    mockRlAnswer = "1 3";
    const result = await withNonTTYStdin(() => {
      return selectMany({ message: "Pick:", items });
    });
    expect(result).toEqual(["x", "z"]);
  });

  test("selectMany fallback handles 'all'", async () => {
    const items = [
      { value: "x", label: "Xray" },
      { value: "y", label: "Yankee" },
    ];
    mockRlAnswer = "all";
    const result = await withNonTTYStdin(() => {
      return selectMany({ message: "Pick:", items });
    });
    expect(result).toEqual(["x", "y"]);
  });

  test("selectMany fallback deduplicates and sorts indices", async () => {
    const items = [
      { value: "x", label: "Xray" },
      { value: "y", label: "Yankee" },
      { value: "z", label: "Zulu" },
    ];
    mockRlAnswer = "3 1 1";
    const result = await withNonTTYStdin(() => {
      return selectMany({ message: "Pick:", items });
    });
    expect(result).toEqual(["x", "z"]);
  });

  test("selectSingle fallback returns null for out-of-range input", async () => {
    mockRlAnswer = "99";
    const result = await withNonTTYStdin(() => {
      return selectSingle({ message: "Pick:", items: sampleItems });
    });
    expect(result).toBeNull();
  });

  test("selectSingle fallback returns null for non-numeric input", async () => {
    mockRlAnswer = "abc";
    const result = await withNonTTYStdin(() => {
      return selectSingle({ message: "Pick:", items: sampleItems });
    });
    expect(result).toBeNull();
  });

  test("selectMany fallback returns empty for out-of-range input", async () => {
    const items = [
      { value: "x", label: "Xray" },
      { value: "y", label: "Yankee" },
    ];
    mockRlAnswer = "0 99";
    const result = await withNonTTYStdin(() => {
      return selectMany({ message: "Pick:", items });
    });
    expect(result).toEqual([]);
  });

  test("selectMany fallback returns empty for non-numeric input", async () => {
    const items = [
      { value: "x", label: "Xray" },
      { value: "y", label: "Yankee" },
    ];
    mockRlAnswer = "abc";
    const result = await withNonTTYStdin(() => {
      return selectMany({ message: "Pick:", items });
    });
    expect(result).toEqual([]);
  });
});

// =============================================================================
// Viewport helpers
// =============================================================================

function manyItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    value: `v${i + 1}`,
    label: `Item ${String(i + 1).padStart(2, "0")}`,
    description: `/path/item-${i + 1}`,
  }));
}

describe("computeViewportHeight", () => {
  test("subtracts chrome lines from the terminal height", () => {
    expect(computeViewportHeight(24)).toBe(18);
  });

  test("falls back to 24 rows when rows is undefined", () => {
    expect(computeViewportHeight(undefined)).toBe(18);
  });

  test("falls back to 24 rows when rows is 0", () => {
    expect(computeViewportHeight(0)).toBe(18);
  });

  test("never returns less than MIN_VIEWPORT_HEIGHT", () => {
    expect(computeViewportHeight(8)).toBe(3);
  });

  test("subtracts extraChrome on top of the fixed chrome lines", () => {
    expect(computeViewportHeight(30, 1)).toBe(23);
  });
});

describe("computeViewport", () => {
  test("returns all-zero fields for an empty list", () => {
    expect(computeViewport(0, 0, 5, 0)).toEqual({
      offset: 0,
      visibleStart: 0,
      visibleEnd: 0,
      hiddenAbove: 0,
      hiddenBelow: 0,
    });
  });

  test("does not scroll when total is smaller than the viewport height", () => {
    expect(computeViewport(3, 0, 10, 0)).toEqual({
      offset: 0,
      visibleStart: 0,
      visibleEnd: 3,
      hiddenAbove: 0,
      hiddenBelow: 0,
    });
  });

  test("does not scroll when total equals the viewport height", () => {
    expect(computeViewport(5, 0, 5, 0)).toEqual({
      offset: 0,
      visibleStart: 0,
      visibleEnd: 5,
      hiddenAbove: 0,
      hiddenBelow: 0,
    });
  });

  test("shows the first window when the cursor is at the top", () => {
    const viewport = computeViewport(20, 0, 5, 0);
    expect(viewport).toEqual({ offset: 0, visibleStart: 0, visibleEnd: 5, hiddenAbove: 0, hiddenBelow: 15 });
  });

  test("shows the last window when the cursor is at the bottom", () => {
    const viewport = computeViewport(20, 19, 5, 0);
    expect(viewport).toEqual({ offset: 15, visibleStart: 15, visibleEnd: 20, hiddenAbove: 15, hiddenBelow: 0 });
  });

  test("downward scrolloff: does not scroll until the cursor enters the scrolloff band", () => {
    expect(computeViewport(20, 3, 5, 0).offset).toBe(0);
    expect(computeViewport(20, 4, 5, 0).offset).toBe(1);
  });

  test("upward scrolloff: does not scroll until the cursor enters the scrolloff band", () => {
    expect(computeViewport(20, 11, 5, 10).offset).toBe(10);
    expect(computeViewport(20, 10, 5, 10).offset).toBe(9);
  });

  test("clamps an out-of-range currentOffset", () => {
    expect(computeViewport(20, 0, 5, 100).offset).toBe(0);
  });

  test("does not throw with a height of 1", () => {
    const viewport = computeViewport(20, 5, 1, 0);
    expect(viewport.visibleEnd).toBe(viewport.offset + 1);
  });
});

describe("viewport rendering", () => {
  test("initial render shows only the first page with a downward scroll indicator", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(output).toContain("Item 01");
        expect(output).toContain("Item 06");
        expect(output).not.toContain("Item 07");
        expect(output).toContain("14 more");
        expect(output.match(/more/g)?.length).toBe(1);

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });

  test("End key jumps to the last page", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        emitKey(KEY_G_UPPER);
        const lastOutput = String(writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0]);
        expect(lastOutput).toContain("14 more");
        expect(lastOutput).toContain("Item 20");
        expect(lastOutput).toContain("20/20");

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });

  test("Home key returns to the first page", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        emitKey(KEY_G_UPPER); // jump to the end first
        emitKey(KEY_G_LOWER); // then back to the start
        const lastOutput = String(writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0]);
        expect(lastOutput).toContain("Item 01");
        expect(lastOutput).toContain("1/20");

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });

  test("PageDown moves the cursor by a full page", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        emitKey(KEY_PAGE_DOWN);
        const lastOutput = String(writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0]);
        expect(lastOutput).toContain("7/20");

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });

  test("PageUp does not wrap past the first page", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        emitKey(KEY_PAGE_UP);
        const lastOutput = String(writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0]);
        expect(lastOutput).toContain("1/20");

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });

  test("CSI Home and End sequences move to the first/last item", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        emitKey(KEY_END_CSI);
        let lastOutput = String(writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0]);
        expect(lastOutput).toContain("20/20");

        emitKey(KEY_HOME_CSI);
        lastOutput = String(writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0]);
        expect(lastOutput).toContain("1/20");

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });

  test("Ctrl+P/Ctrl+N move the cursor like arrow keys", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectSingle({ message: "Pick:", items: sampleItems });
      emitKey(KEY_CTRL_N); // down to Beta
      emitKey(KEY_CTRL_N); // down to Gamma
      emitKey(KEY_CTRL_P); // up to Beta
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("b");
    });
  });

  test("footer shows the cursor position", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(output).toContain("1/20");

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });

  test("no rendered line exceeds the terminal width", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectMany({
          message: "Pick a candidate from the very long list of options below:",
          items: manyItems(20),
        });

        const lastOutput = String(writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0]);
        const lines = lastOutput.split("\n").filter((line) => line.length > 0);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(stringWidth(line)).toBeLessThanOrEqual(29);
        }

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12, columns: 30 },
    );
  });

  test("SIGWINCH triggers a redraw", () => {
    return withTTYStdin(
      async (emitKey) => {
        const writeSpy = vi.spyOn(process.stdout, "write");
        const promise = selectSingle({ message: "Pick:", items: manyItems(20) });

        const callsBefore = writeSpy.mock.calls.length;
        process.emit("SIGWINCH");
        const callsAfter = writeSpy.mock.calls.length;
        expect(callsAfter).toBeGreaterThan(callsBefore);

        emitKey(KEY_ENTER);
        await promise;
      },
      { rows: 12 },
    );
  });
});

// =============================================================================
// Filtering
// =============================================================================

describe("fuzzyMatch", () => {
  test("empty query matches everything with no positions", () => {
    expect(fuzzyMatch("Alpha", "")).toEqual([]);
  });

  test("matches a case-insensitive prefix", () => {
    expect(fuzzyMatch("Alpha", "al")).toEqual([0, 1]);
  });

  test("matches a contiguous substring elsewhere in the text", () => {
    expect(fuzzyMatch("Gamma", "am")).toEqual([1, 2]);
  });

  test("matches a non-contiguous subsequence in ascending order", () => {
    const positions = fuzzyMatch("feature/auth", "fauth");
    expect(positions).not.toBeNull();
    const sorted = [...(positions as number[])].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  test("matches a subsequence at the end of the text", () => {
    expect(fuzzyMatch("Alpha", "ph")).toEqual([2, 3]);
  });

  test("returns null when a character is missing", () => {
    expect(fuzzyMatch("Alpha", "z")).toBeNull();
  });

  test("returns null when the characters are out of order", () => {
    expect(fuzzyMatch("Alpha", "ahp")).toBeNull();
  });

  test("returns null for a non-empty query against empty text", () => {
    expect(fuzzyMatch("", "a")).toBeNull();
  });

  test("is case-insensitive on both text and query", () => {
    expect(fuzzyMatch("ALPHA", "alpha")).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("filterItems", () => {
  test("empty query returns every item with no label matches", () => {
    expect(filterItems(sampleItems, "")).toEqual([
      { index: 0, labelMatches: [] },
      { index: 1, labelMatches: [] },
      { index: 2, labelMatches: [] },
    ]);
  });

  test("matches only the label that contains the query as a subsequence", () => {
    expect(filterItems(sampleItems, "am")).toEqual([{ index: 2, labelMatches: [1, 2] }]);
  });

  test("matches on description when the label does not match", () => {
    const items = [{ value: "a", label: "Alpha", description: "worktree-path" }];
    expect(filterItems(items, "tree")).toEqual([{ index: 0, labelMatches: [] }]);
  });

  test("matches on hint when neither the label nor description matches", () => {
    const items = [{ value: "a", label: "Alpha", hint: "merged" }];
    expect(filterItems(items, "mrg")).toEqual([{ index: 0, labelMatches: [] }]);
  });

  test("excludes items that match nowhere", () => {
    expect(filterItems(sampleItems, "xyz123")).toEqual([]);
  });

  test("keeps the original item order", () => {
    const result = filterItems(sampleItems, "a");
    expect(result.map((m) => m.index)).toEqual([0, 1, 2]);
  });
});

describe("filtering (TTY)", () => {
  test("/ enters filter mode: footer shows filter hints and header shows the query", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      writeSpy.mockClear();
      emitKey(KEY_SLASH);
      const output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("Type to filter");
      expect(output).toContain("Filter:");

      emitKey(KEY_ENTER); // leave filter input mode, query kept ("")
      emitKey(KEY_ENTER); // confirm
      await promise;
    });
  });

  test("query narrows visible items and shows the match count", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "a");
      writeSpy.mockClear();
      typeText(emitKey, "m"); // only inspect the render that follows the final keystroke
      const raw = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      const output = stripAnsi(raw);
      expect(output).toContain("Filter: am");
      expect(output).toContain("(1/3)");
      expect(output).toContain("Gamma");
      expect(output).not.toContain("Alpha");
      expect(output).not.toContain("Beta");
      // The matched "am" run is highlighted; the label is otherwise split across
      // separately-colored runs, so this check must use the raw (non-stripped) output.
      expect(raw).toContain(styles("am", "cyan", "bold"));

      emitKey(KEY_ENTER);
      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("Enter leaves filter input mode but keeps the query, then confirms the filtered match", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "am");
      writeSpy.mockClear();
      emitKey(KEY_ENTER);
      const output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("navigate");
      expect(output).toContain("Filter: am");

      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("c");
    });
  });

  test("Esc while filtering discards the query without canceling the prompt", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "am");
      writeSpy.mockClear();
      emitKey(KEY_ESC);
      const output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("Alpha");
      expect(output).toContain("Beta");
      expect(output).toContain("Gamma");

      emitKey(KEY_ENTER);
      const result = await promise;
      // setQuery keeps the cursor anchored to the item it was on (Gamma), it does not
      // reset to the top of the unfiltered list.
      expect(result).toBe("c");
    });
  });

  test("Backspace removes the last filter character", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "am");
      writeSpy.mockClear();
      emitKey(KEY_BACKSPACE);
      const output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      // fuzzyMatch("Beta", "a") also matches (the trailing "a"), so all three survive.
      expect(output).toContain("Filter: a");
      expect(output).toContain("(3/3)");

      emitKey(KEY_ENTER);
      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("Ctrl+U clears the filter query while staying in filter mode", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "am");
      writeSpy.mockClear();
      emitKey(KEY_CTRL_U);
      const output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("Filter:");
      expect(output).toContain("Alpha");
      expect(output).toContain("Beta");
      expect(output).toContain("Gamma");

      emitKey(KEY_ENTER);
      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("Enter does not confirm when the filtered list has no matches", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "zzz");
      const output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("no matches");

      emitKey(KEY_ENTER); // leaves filter input mode; still zero matches
      let settled = false;
      promise.then(() => {
        settled = true;
      });
      emitKey(KEY_ENTER); // nothing to confirm
      await new Promise((r) => setImmediate(r));
      expect(settled).toBe(false);

      emitKey(KEY_ESC); // clears the query, does not cancel the prompt
      emitKey(KEY_ENTER);
      const result = await promise;
      expect(result).toBe("a");
    });
  });

  test("arrow keys and Ctrl+P/Ctrl+N move the cursor while filtering", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "a"); // matches all three items
      writeSpy.mockClear();
      emitKey(KEY_DOWN);
      let output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("2/3");

      writeSpy.mockClear();
      emitKey(KEY_CTRL_N);
      output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("3/3");

      writeSpy.mockClear();
      emitKey(KEY_CTRL_P);
      output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("2/3");

      emitKey(KEY_ENTER);
      emitKey(KEY_ENTER);
      await promise;
    });
  });

  test("j/k/q/a are typed into the query while filtering instead of navigating", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectSingle({ message: "Pick:", items: sampleItems });

      emitKey(KEY_SLASH);
      writeSpy.mockClear();
      emitKey(KEY_Q);
      let output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("Filter: q");

      let settled = false;
      promise.then(() => {
        settled = true;
      });
      emitKey(KEY_J);
      emitKey(KEY_K);
      emitKey(KEY_A);
      output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("Filter: qjka");
      await new Promise((r) => setImmediate(r));
      expect(settled).toBe(false);

      emitKey(KEY_CTRL_U); // back to a non-empty match list so the prompt can be closed
      emitKey(KEY_ENTER);
      emitKey(KEY_ENTER);
      await promise;
    });
  });
});

describe("filtering with selectMany", () => {
  const indexItems = [
    { value: "x", label: "Xray" },
    { value: "y", label: "Yankee" },
    { value: "z", label: "Zulu" },
  ];

  test("toggling a filtered match selects the original item, surviving a discarded filter", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: indexItems });
      emitKey(KEY_SLASH);
      typeText(emitKey, "zu"); // matches only Zulu
      emitKey(KEY_ENTER); // leave filter input mode, query kept
      emitKey(KEY_SPACE); // toggle the (filtered) current item: Zulu
      emitKey(KEY_ESC); // discard the query, back to the full list; selection survives
      emitKey(KEY_ENTER); // confirm
      const result = await promise;
      expect(result).toEqual(["z"]);
    });
  });

  test("toggle-all while a query is active affects only the visible matches", () => {
    return withTTYStdin(async (emitKey) => {
      const promise = selectMany({ message: "Pick:", items: indexItems });
      emitKey(KEY_SLASH);
      typeText(emitKey, "y"); // matches Xray and Yankee
      emitKey(KEY_ENTER); // leave filter input mode, query kept
      emitKey(KEY_A); // toggle all visible matches
      emitKey(KEY_ENTER); // confirm
      const result = await promise;
      expect(result).toEqual(["x", "y"]);
    });
  });

  test("footer shows 'all matches' and 'Esc clear' once a query narrows the results", () => {
    return withTTYStdin(async (emitKey) => {
      const writeSpy = vi.spyOn(process.stdout, "write");
      const promise = selectMany({ message: "Pick:", items: indexItems });

      emitKey(KEY_SLASH);
      typeText(emitKey, "y");
      writeSpy.mockClear();
      emitKey(KEY_ENTER); // leave filter input mode, query kept
      const output = stripAnsi(writeSpy.mock.calls.map((c) => String(c[0])).join(""));
      expect(output).toContain("all matches");
      expect(output).toContain("Esc clear");

      emitKey(KEY_ENTER); // confirm
      await promise;
    });
  });
});
