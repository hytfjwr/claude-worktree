import { afterEach, describe, expect, test, vi } from "vitest";

import type { WorktreeInfo, WorktreeStatus } from "../types/index.ts";

// =============================================================================
// Mocks
// =============================================================================

let mockRlAnswer = "";
// Records the last prompt string passed to readline's question(), so danger-mode
// tests can assert the message is not duplicated between the heading and the prompt.
let lastRlPrompt = "";
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (prompt: string, cb: (answer: string) => void) => {
      lastRlPrompt = prompt;
      cb(mockRlAnswer);
    },
    close: vi.fn(),
  }),
}));

const mockSelectSingle = vi.fn();
const mockSelectMany = vi.fn();
vi.mock("./select.ts", () => ({
  selectSingle: (...args: unknown[]) => mockSelectSingle(...args),
  selectMany: (...args: unknown[]) => mockSelectMany(...args),
}));

vi.mock("./logger.ts", () => ({
  logInfo: vi.fn(),
}));

import { logInfo } from "./logger.ts";
import { confirm, selectMultiple, selectWorktree } from "./prompt.ts";

const mockedLogInfo = vi.mocked(logInfo);

afterEach(() => {
  mockSelectSingle.mockReset();
  mockSelectMany.mockReset();
  mockedLogInfo.mockClear();
});

// =============================================================================
// confirm
// =============================================================================

describe("confirm", () => {
  test("returns true for 'y'", async () => {
    mockRlAnswer = "y";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for 'yes'", async () => {
    mockRlAnswer = "yes";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for 'Y' (case insensitive)", async () => {
    mockRlAnswer = "Y";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for 'YES' (case insensitive)", async () => {
    mockRlAnswer = "YES";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for input with whitespace", async () => {
    mockRlAnswer = "  y  ";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns false for 'n'", async () => {
    mockRlAnswer = "n";
    expect(await confirm("Delete?")).toBe(false);
  });

  test("returns false for empty input", async () => {
    mockRlAnswer = "";
    expect(await confirm("Delete?")).toBe(false);
  });

  test("returns false for arbitrary text", async () => {
    mockRlAnswer = "maybe";
    expect(await confirm("Delete?")).toBe(false);
  });

  test("returns false for 'ye' (partial match)", async () => {
    mockRlAnswer = "ye";
    expect(await confirm("Delete?")).toBe(false);
  });
});

// =============================================================================
// selectWorktree
// =============================================================================

describe("selectWorktree", () => {
  const worktrees: WorktreeInfo[] = [
    { path: "/repo/wt/feat-auth", branch: "feat/auth", isLocked: false, isDirty: false, isMain: false },
    { path: "/repo/wt/detached", branch: null, isLocked: false, isDirty: false, isMain: false },
  ];

  test("maps WorktreeInfo to SelectItem correctly", async () => {
    mockSelectSingle.mockResolvedValue(worktrees[0]);

    await selectWorktree(worktrees);

    expect(mockSelectSingle).toHaveBeenCalledWith({
      message: "Select worktree to resume:",
      items: [
        { value: worktrees[0], label: "feat/auth", description: "/repo/wt/feat-auth" },
        { value: worktrees[1], label: "(detached)", description: "/repo/wt/detached" },
      ],
    });
  });

  test("returns selected worktree", async () => {
    mockSelectSingle.mockResolvedValue(worktrees[0]);

    const result = await selectWorktree(worktrees);
    expect(result).toBe(worktrees[0]);
  });

  test("returns null when user cancels", async () => {
    mockSelectSingle.mockResolvedValue(null);

    const result = await selectWorktree(worktrees);
    expect(result).toBeNull();
  });
});

// =============================================================================
// selectMultiple
// =============================================================================

describe("selectMultiple", () => {
  const statuses: WorktreeStatus[] = [
    {
      worktree: { path: "/repo/wt/feat-a", branch: "feat/a", isLocked: false, isDirty: false, isMain: false },
      branchMerged: true,
      branchDeletedOnRemote: false,
      canAutoClean: true,
      reason: "branch merged",
    },
    {
      worktree: { path: "/repo/wt/detached", branch: null, isLocked: false, isDirty: false, isMain: false },
      branchMerged: false,
      branchDeletedOnRemote: true,
      canAutoClean: true,
      reason: "remote deleted",
    },
  ];

  test("maps WorktreeStatus to SelectItem correctly", async () => {
    mockSelectMany.mockResolvedValue([statuses[0]]);

    await selectMultiple(statuses);

    expect(mockSelectMany).toHaveBeenCalledWith({
      message: "Select worktrees to clean:",
      items: [
        { value: statuses[0], label: "feat/a", description: "/repo/wt/feat-a", hint: "branch merged" },
        { value: statuses[1], label: "(detached)", description: "/repo/wt/detached", hint: "remote deleted" },
      ],
    });
  });

  test("returns selected statuses", async () => {
    mockSelectMany.mockResolvedValue([statuses[0], statuses[1]]);

    const result = await selectMultiple(statuses);
    expect(result).toEqual([statuses[0], statuses[1]]);
  });

  test("returns empty array when user cancels", async () => {
    mockSelectMany.mockResolvedValue([]);

    const result = await selectMultiple(statuses);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// confirm (TTY) — single-key harness
// =============================================================================

type TtyHarness = {
  setRawMode: ReturnType<typeof vi.fn>;
  stdoutWrite: ReturnType<typeof vi.fn>;
  press: (key: string | number | Buffer) => void;
  restore: () => void;
};

function setupTty(): TtyHarness {
  const stdin = process.stdin;
  const savedIsTTY = Object.getOwnPropertyDescriptor(stdin, "isTTY");
  const savedSetRawMode = Object.getOwnPropertyDescriptor(stdin, "setRawMode");
  Object.defineProperty(stdin, "isTTY", { value: true, configurable: true, writable: true });
  const setRawMode = vi.fn();
  Object.defineProperty(stdin, "setRawMode", { value: setRawMode, configurable: true, writable: true });
  const resume = vi.spyOn(stdin, "resume").mockReturnValue(stdin);
  const pause = vi.spyOn(stdin, "pause").mockReturnValue(stdin);
  const stdoutWrite = vi.fn().mockReturnValue(true);
  const write = vi.spyOn(process.stdout, "write").mockImplementation(stdoutWrite);
  return {
    setRawMode,
    stdoutWrite,
    press: (key) => {
      const buf = Buffer.isBuffer(key) ? key : typeof key === "string" ? Buffer.from(key) : Buffer.from([key]);
      stdin.emit("data", buf);
    },
    restore: () => {
      resume.mockRestore();
      pause.mockRestore();
      write.mockRestore();
      if (savedIsTTY) Object.defineProperty(stdin, "isTTY", savedIsTTY);
      else delete (stdin as unknown as Record<string, unknown>).isTTY;
      if (savedSetRawMode) Object.defineProperty(stdin, "setRawMode", savedSetRawMode);
      else delete (stdin as unknown as Record<string, unknown>).setRawMode;
    },
  };
}

describe("confirm (TTY)", () => {
  test("resolves true for 'y'", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("y");
      expect(await promise).toBe(true);
    } finally {
      tty.restore();
    }
  });

  test("resolves true for 'Y'", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("Y");
      expect(await promise).toBe(true);
    } finally {
      tty.restore();
    }
  });

  test("resolves false for 'n'", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("n");
      expect(await promise).toBe(false);
    } finally {
      tty.restore();
    }
  });

  test("resolves false for 'N'", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("N");
      expect(await promise).toBe(false);
    } finally {
      tty.restore();
    }
  });

  test("resolves false for Esc", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press(0x1b);
      expect(await promise).toBe(false);
    } finally {
      tty.restore();
    }
  });

  test("resolves false for 'q'", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("q");
      expect(await promise).toBe(false);
    } finally {
      tty.restore();
    }
  });

  test("resolves false for Enter (CR)", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press(0x0d);
      expect(await promise).toBe(false);
    } finally {
      tty.restore();
    }
  });

  test("resolves false for Enter (LF)", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press(0x0a);
      expect(await promise).toBe(false);
    } finally {
      tty.restore();
    }
  });

  test("ignores an unmapped key and keeps waiting until a decisive key arrives", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("x");
      tty.press("y");
      expect(await promise).toBe(true);
    } finally {
      tty.restore();
    }
  });

  test("ignores multi-byte sequences such as arrow key escape codes", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press(Buffer.from([0x1b, 0x5b, 0x41]));

      let settled = false;
      promise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      tty.press("n");
      expect(await promise).toBe(false);
    } finally {
      tty.restore();
    }
  });

  test("restores raw mode and the data listener count after resolving", async () => {
    const tty = setupTty();
    try {
      const listenersBefore = process.stdin.listenerCount("data");
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("y");
      expect(await promise).toBe(true);

      expect(tty.setRawMode.mock.calls.map((call) => call[0])).toEqual([true, false]);
      expect(process.stdin.listenerCount("data")).toBe(listenersBefore);
    } finally {
      tty.restore();
    }
  });

  test("writes the prompt line to stdout", async () => {
    const tty = setupTty();
    try {
      const promise = confirm("Delete?");
      await Promise.resolve();
      tty.press("n");
      await promise;

      const wrotePrompt = tty.stdoutWrite.mock.calls.some(
        (call) => typeof call[0] === "string" && call[0].includes("(y/N)"),
      );
      expect(wrotePrompt).toBe(true);
    } finally {
      tty.restore();
    }
  });

  test("Ctrl+C restores raw mode and exits with code 130", async () => {
    const tty = setupTty();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    try {
      // This promise intentionally never resolves once Ctrl+C is pressed, so it is not awaited.
      confirm("Delete?");
      await Promise.resolve();
      tty.press(0x03);

      expect(exitSpy).toHaveBeenCalledWith(130);
      expect(tty.setRawMode).toHaveBeenCalledWith(false);
    } finally {
      exitSpy.mockRestore();
      tty.restore();
    }
  });
});

// =============================================================================
// confirm (danger)
// =============================================================================

describe("confirm (danger)", () => {
  test("renders a warning heading and detail lines via logInfo", async () => {
    mockRlAnswer = "n";

    await confirm("Delete 2 worktree(s)?", { danger: true, details: ["feature/auth", "fix/bug-123"] });

    const lines = mockedLogInfo.mock.calls.map((call) => call[0]);
    expect(lines.some((line) => line.includes("Delete 2 worktree(s)?"))).toBe(true);
    expect(lines.some((line) => line.includes("feature/auth"))).toBe(true);
    expect(lines.some((line) => line.includes("fix/bug-123"))).toBe(true);
  });

  test("does not duplicate the message in the readline prompt", async () => {
    mockRlAnswer = "n";

    await confirm("Delete 2 worktree(s)?", { danger: true, details: ["feature/auth"] });

    expect(lastRlPrompt.startsWith("(y/N):")).toBe(true);
  });

  test("does not call logInfo for a non-danger confirm", async () => {
    mockRlAnswer = "n";

    await confirm("Delete?");

    expect(mockedLogInfo).not.toHaveBeenCalled();
  });
});
