import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { saveEnv } from "../__test-utils__.ts";
import { _resetColorCache } from "./color.ts";
import { selectMany, selectSingle } from "./select.ts";

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
 * and returns an emitKey helper to simulate key presses.
 */
function withTTYStdin<T>(fn: (emitKey: (bytes: number[]) => void) => T): T {
  const stdin = process.stdin as typeof process.stdin & StdinMock;
  const saved = {
    stdinIsTTY: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
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
