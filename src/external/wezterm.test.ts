import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createExecStub } from "../__test-utils__.ts";
import { getCurrentPaneId } from "./wezterm.ts";

// Hoisted mock for ../core/exec — default passthrough, overridable per-test via mockExecImpl
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

// Mock child_process spawn for sendText tests
const { mockSpawnImpl } = vi.hoisted(() => ({
  mockSpawnImpl: { current: null as ((cmd: string, args: string[], opts: unknown) => unknown) | null },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("node:child_process");
  return {
    ...original,
    spawn: (cmd: string, args: string[], opts: unknown) => {
      if (mockSpawnImpl.current) {
        return mockSpawnImpl.current(cmd, args, opts);
      }
      return original.spawn(cmd, args, opts as Parameters<typeof original.spawn>[2]);
    },
  };
});

/**
 * Create a fake spawn that simulates a process with stdin/stdout/stderr.
 */
function createMockSpawn(config: { exitCode?: number } = {}) {
  const { exitCode = 0 } = config;
  let capturedStdin = "";
  let capturedCmd = "";
  let capturedArgs: string[] = [];

  const mockSpawn = (_cmd: string, _args: string[], _opts: unknown) => {
    capturedCmd = _cmd;
    capturedArgs = _args;
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    const proc = {
      stdin: {
        end(data?: string) {
          if (data) capturedStdin += data;
          // Trigger close event on next tick
          const closeFns = listeners.get("close") || [];
          setTimeout(() => {
            for (const fn of closeFns) fn(exitCode);
          }, 0);
        },
      },
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      once(event: string, fn: (...args: unknown[]) => void) {
        const fns = listeners.get(event) || [];
        fns.push(fn);
        listeners.set(event, fns);
        return proc;
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        const fns = listeners.get(event) || [];
        fns.push(fn);
        listeners.set(event, fns);
        return proc;
      },
    };
    return proc;
  };

  return {
    mockSpawn,
    getCaptured: () => ({ stdin: capturedStdin, cmd: capturedCmd, args: capturedArgs }),
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

// ============================================================================
// Tests for functions using exec (mocking exec dependency)
// ============================================================================

describe("listWeztermPanes", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns null when WezTerm is not available", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      // which wezterm → not found
      if (args.includes("wezterm") && _cmd === "which") {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listWeztermPanes } = await import("./wezterm.ts");
    const result = await listWeztermPanes();
    expect(result).toBeNull();
  });

  test("returns parsed panes", async () => {
    const mockJson =
      '[{"pane_id":1,"title":"claude","cwd":"/tmp/wt-1"},{"pane_id":2,"title":"shell","cwd":"/tmp/wt-2"}]';

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") {
        return { stdout: "/usr/bin/wezterm\n" };
      }
      if (args.includes("list") && args.includes("--format")) {
        return { stdout: mockJson };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listWeztermPanes } = await import("./wezterm.ts");
    const result = await listWeztermPanes();
    expect(result).toEqual([
      { paneId: 1, title: "claude", cwd: "/tmp/wt-1" },
      { paneId: 2, title: "shell", cwd: "/tmp/wt-2" },
    ]);
  });

  test("returns null when cli list fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") {
        return { stdout: "/usr/bin/wezterm\n" };
      }
      if (args.includes("list")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listWeztermPanes } = await import("./wezterm.ts");
    const result = await listWeztermPanes();
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON response", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") {
        return { stdout: "/usr/bin/wezterm\n" };
      }
      if (args.includes("list")) {
        return { stdout: "not json" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listWeztermPanes } = await import("./wezterm.ts");
    const result = await listWeztermPanes();
    expect(result).toBeNull();
  });
});

describe("splitPaneRight", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns pane ID from exec output", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("split-pane")) {
        return { stdout: "new-pane-123\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { splitPaneRight } = await import("./wezterm.ts");
    const result = await splitPaneRight();

    expect(result).toBe("new-pane-123");
  });

  test("passes --right flag", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("split-pane")) {
        capturedArgs = args;
        return { stdout: "42\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { splitPaneRight } = await import("./wezterm.ts");
    await splitPaneRight();

    expect(capturedArgs).toContain("--right");
  });
});

describe("sendText", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSpawnImpl.current = null;
  });
  afterEach(() => {
    mockSpawnImpl.current = null;
  });

  test("sends text to specified pane via spawn stdin", async () => {
    const { mockSpawn, getCaptured } = createMockSpawn();
    mockSpawnImpl.current = mockSpawn as typeof mockSpawnImpl.current;

    const { sendText } = await import("./wezterm.ts");
    await sendText("pane-123", "hello world");

    const captured = getCaptured();
    expect(captured.cmd).toBe("wezterm");
    expect(captured.args).toContain("send-text");
    expect(captured.args).toContain("--pane-id");
    expect(captured.args).toContain("pane-123");
    expect(captured.args).toContain("--no-paste");
    expect(captured.stdin).toBe("hello world");
  });

  test("rejects when spawn exits with non-zero code", async () => {
    const { mockSpawn } = createMockSpawn({ exitCode: 1 });
    mockSpawnImpl.current = mockSpawn as typeof mockSpawnImpl.current;

    const { sendText } = await import("./wezterm.ts");
    await expect(sendText("pane-123", "text")).rejects.toThrow("exit code 1");
  });
});

describe("sendCommand", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSpawnImpl.current = null;
  });
  afterEach(() => {
    mockSpawnImpl.current = null;
  });

  test("sends text with trailing newline", async () => {
    const { mockSpawn, getCaptured } = createMockSpawn();
    mockSpawnImpl.current = mockSpawn as typeof mockSpawnImpl.current;

    const { sendCommand } = await import("./wezterm.ts");
    await sendCommand("pane-123", "ls -la");

    const captured = getCaptured();
    expect(captured.stdin).toBe("ls -la\n");
  });
});

describe("activatePane", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("calls wezterm cli activate-pane with correct pane ID", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("activate-pane")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { activatePane } = await import("./wezterm.ts");
    await activatePane("target-pane-456");

    expect(capturedArgs).toContain("activate-pane");
    expect(capturedArgs).toContain("--pane-id");
    expect(capturedArgs).toContain("target-pane-456");
  });
});

describe("createPane", () => {
  let savedWeztermPane: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
    savedWeztermPane = process.env.WEZTERM_PANE;
  });
  afterEach(() => {
    mockExecImpl.current = null;
    if (savedWeztermPane === undefined) {
      delete process.env.WEZTERM_PANE;
    } else {
      process.env.WEZTERM_PANE = savedWeztermPane;
    }
  });

  test("creates pane via splitPaneRight and returns new paneId", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("split-pane")) {
        return { stdout: "created-pane-999\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createPane } = await import("./wezterm.ts");
    const result = await createPane({});

    expect(result).toBe("created-pane-999");
  });

  test("creates pane with keepFocus - activates original pane", async () => {
    process.env.WEZTERM_PANE = "original-42";

    let activatedPaneId = "";
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("split-pane")) {
        return { stdout: "new-pane\n" };
      }
      if (args.includes("activate-pane")) {
        activatedPaneId = args[args.indexOf("--pane-id") + 1];
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createPane } = await import("./wezterm.ts");
    const result = await createPane({ keepFocus: true });

    expect(result).toBe("new-pane");
    expect(activatedPaneId).toBe("original-42");
  });
});
