import type { SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ExecResult } from "../core/exec.ts";
import { getCurrentPaneId } from "./wezterm.ts";

// Hoisted mock for ../core/exec.ts — default passthrough, overridable per-test
const { mockExecImpl } = vi.hoisted(() => ({
  mockExecImpl: { current: null as ((cmd: string, args: string[]) => unknown) | null },
}));

vi.mock("../core/exec.ts", async (importOriginal) => {
  const original = (await importOriginal()) as { exec: (cmd: string, args: string[]) => unknown };
  return {
    ...original,
    exec: (cmd: string, args: string[]) => {
      if (mockExecImpl.current) {
        return mockExecImpl.current(cmd, args);
      }
      return original.exec(cmd, args);
    },
  };
});

// Hoisted mock for node:child_process spawn — default passthrough, overridable per-test
const { mockSpawnImpl } = vi.hoisted(() => ({
  mockSpawnImpl: {
    current: null as ((cmd: string, args: string[], options?: SpawnOptions) => unknown) | null,
  },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("node:child_process");
  return {
    ...original,
    spawn: (cmd: string, args: readonly string[], options?: SpawnOptions) => {
      if (mockSpawnImpl.current) {
        return mockSpawnImpl.current(cmd, args as string[], options);
      }
      return options ? original.spawn(cmd, args as string[], options) : original.spawn(cmd, args as string[]);
    },
  };
});

/**
 * Create a fake ExecBuilder that mirrors the real exec() return type contract.
 */
function createExecStub(handler: (cmd: string, args: string[]) => { stdout: string; exitCode?: number }) {
  return (cmd: string, args: string[]) => {
    const { stdout, exitCode = 0 } = handler(cmd, args);
    const result: ExecResult = {
      exitCode,
      stdout: Buffer.from(stdout),
      stderr: Buffer.alloc(0),
      text: () => stdout,
    };
    const builder = {
      nothrow() {
        return this;
      },
      quiet() {
        return this;
      },
      text: () => Promise.resolve(stdout),
      // biome-ignore lint/suspicious/noThenProperty: intentional PromiseLike implementation for exec stub
      then(resolve?: ((value: ExecResult) => unknown) | null, reject?: ((reason: unknown) => unknown) | null) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  };
}

/**
 * Create a fake spawn that captures command/args/stdin and emits "close" asynchronously.
 */
function createFakeSpawn(exitCode = 0) {
  let capturedCmd = "";
  let capturedArgs: string[] = [];
  let capturedStdin = "";

  const mockFn = (cmd: string, args: string[], _options?: SpawnOptions) => {
    capturedCmd = cmd;
    capturedArgs = [...args];
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const proc = {
      once(event: string, handler: (...args: unknown[]) => void) {
        listeners.set(event, handler);
      },
      stdin: {
        end(data?: string) {
          if (data !== undefined) capturedStdin += data;
          process.nextTick(() => {
            const closeHandler = listeners.get("close");
            if (closeHandler) closeHandler(exitCode);
          });
        },
      },
    };
    return proc;
  };

  return {
    mockFn,
    getCapturedCmd: () => capturedCmd,
    getCapturedArgs: () => capturedArgs,
    getCapturedStdin: () => capturedStdin,
  };
}

// ============================================================================
// Tests for pure functions using environment variables (no mocks needed)
// ============================================================================

describe("getCurrentPaneId", () => {
  const originalEnv = process.env.WEZTERM_PANE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WEZTERM_PANE;
    } else {
      process.env.WEZTERM_PANE = originalEnv;
    }
  });

  test("retrieves from environment variable", () => {
    process.env.WEZTERM_PANE = "123";
    const result = getCurrentPaneId();
    expect(result).toBe("123");
  });

  test("returns undefined when not set", () => {
    delete process.env.WEZTERM_PANE;
    const result = getCurrentPaneId();
    expect(result).toBeUndefined();
  });
});

describe("listWeztermPanes", () => {
  beforeEach(() => vi.resetModules());

  test("returns null when WezTerm is not available (mock)", async () => {
    vi.doMock("./wezterm.ts", async () => ({
      ...(await vi.importActual("./wezterm.ts")),
      listWeztermPanes: vi.fn(async () => null),
    }));

    const { listWeztermPanes: mockedList } = await import("./wezterm.ts");
    const result = await mockedList();
    expect(result).toBeNull();
  });

  test("returns parsed panes (mock)", async () => {
    const mockPanes = [
      { pane_id: 1, title: "claude", cwd: "/tmp/wt-1" },
      { pane_id: 2, title: "shell", cwd: "/tmp/wt-2" },
    ];
    vi.doMock("./wezterm.ts", async () => ({
      ...(await vi.importActual("./wezterm.ts")),
      listWeztermPanes: vi.fn(async () => mockPanes),
    }));

    const { listWeztermPanes: mockedList } = await import("./wezterm.ts");
    const result = await mockedList();
    expect(result).toEqual(mockPanes);
    expect(result?.[0].pane_id).toBe(1);
    expect(result?.[1].title).toBe("shell");
  });
});

// ============================================================================
// Tests for functions using exec (mocking ../core/exec.ts)
// ============================================================================

describe("exec-based wezterm functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });

  afterEach(() => {
    mockExecImpl.current = null;
  });

  describe("splitPaneRight", () => {
    test("returns pane ID from wezterm cli", async () => {
      mockExecImpl.current = createExecStub((cmd, args) => {
        if (cmd === "wezterm" && args.includes("split-pane")) {
          return { stdout: "new-pane-123\n" };
        }
        throw new Error(`Unhandled: ${cmd} ${args.join(" ")}`);
      });

      const { splitPaneRight } = await import("./wezterm.ts");
      const result = await splitPaneRight();

      expect(result).toBe("new-pane-123");
    });
  });

  describe("activatePane", () => {
    test("calls wezterm cli activate-pane with correct pane ID", async () => {
      let capturedArgs: string[] = [];
      mockExecImpl.current = createExecStub((cmd, args) => {
        if (cmd === "wezterm" && args.includes("activate-pane")) {
          capturedArgs = args;
          return { stdout: "" };
        }
        throw new Error(`Unhandled: ${cmd} ${args.join(" ")}`);
      });

      const { activatePane } = await import("./wezterm.ts");
      await activatePane("target-pane-456");

      expect(capturedArgs).toEqual(["cli", "activate-pane", "--pane-id", "target-pane-456"]);
    });
  });

  describe("createPane", () => {
    const originalEnv = process.env.WEZTERM_PANE;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.WEZTERM_PANE;
      } else {
        process.env.WEZTERM_PANE = originalEnv;
      }
    });

    test("creates pane and returns new paneId", async () => {
      mockExecImpl.current = createExecStub((cmd, args) => {
        if (cmd === "wezterm" && args.includes("split-pane")) {
          return { stdout: "created-pane-999\n" };
        }
        throw new Error(`Unhandled: ${cmd} ${args.join(" ")}`);
      });

      const { createPane } = await import("./wezterm.ts");
      const result = await createPane({});

      expect(result).toBe("created-pane-999");
    });

    test("creates pane with keepFocus restores original pane", async () => {
      process.env.WEZTERM_PANE = "original-pane-1";
      let activatedPaneId = "";

      mockExecImpl.current = createExecStub((cmd, args) => {
        if (cmd === "wezterm" && args.includes("split-pane")) {
          return { stdout: "new-pane\n" };
        }
        if (cmd === "wezterm" && args.includes("activate-pane")) {
          activatedPaneId = args[args.indexOf("--pane-id") + 1];
          return { stdout: "" };
        }
        throw new Error(`Unhandled: ${cmd} ${args.join(" ")}`);
      });

      const { createPane } = await import("./wezterm.ts");
      const result = await createPane({ keepFocus: true });

      expect(result).toBe("new-pane");
      expect(activatedPaneId).toBe("original-pane-1");
    });
  });
});

// ============================================================================
// Tests for functions using spawn (mocking node:child_process)
// ============================================================================

describe("spawn-based wezterm functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSpawnImpl.current = null;
  });

  afterEach(() => {
    mockSpawnImpl.current = null;
  });

  describe("sendText", () => {
    test("sends text via wezterm cli send-text", async () => {
      const fake = createFakeSpawn(0);
      mockSpawnImpl.current = fake.mockFn;

      const { sendText } = await import("./wezterm.ts");
      await sendText("pane-123", "hello world");

      expect(fake.getCapturedCmd()).toBe("wezterm");
      expect(fake.getCapturedArgs()).toEqual(["cli", "send-text", "--no-paste", "--pane-id", "pane-123"]);
      expect(fake.getCapturedStdin()).toBe("hello world");
    });

    test("rejects when exit code is non-zero", async () => {
      const fake = createFakeSpawn(1);
      mockSpawnImpl.current = fake.mockFn;

      const { sendText } = await import("./wezterm.ts");
      await expect(sendText("pane-123", "hello")).rejects.toThrow("wezterm send-text failed with exit code 1");
    });
  });

  describe("sendCommand", () => {
    test("sends command with trailing newline via sendText", async () => {
      const fake = createFakeSpawn(0);
      mockSpawnImpl.current = fake.mockFn;

      const { sendCommand } = await import("./wezterm.ts");
      await sendCommand("pane-123", "ls -la");

      expect(fake.getCapturedStdin()).toBe("ls -la\n");
    });
  });
});
