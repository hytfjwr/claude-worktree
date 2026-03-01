import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createExecStub, saveEnv } from "../__test-utils__.ts";
import { getCurrentPaneId } from "./tmux.ts";

// Hoisted mock for ../core/exec
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

// ============================================================================
// Tests for pure functions using environment variables
// ============================================================================

describe("getCurrentPaneId", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveEnv("TMUX_PANE");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("retrieves from environment variable", () => {
    process.env.TMUX_PANE = "%42";
    const result = getCurrentPaneId();
    expect(result).toBe("%42");
  });

  test("returns undefined when not set", () => {
    delete process.env.TMUX_PANE;
    const result = getCurrentPaneId();
    expect(result).toBeUndefined();
  });
});

describe("isRunningInsideTmux", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    vi.resetModules();
    restoreEnv = saveEnv("TMUX");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns true when TMUX is set", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    const { isRunningInsideTmux } = await import("./tmux.ts");
    expect(isRunningInsideTmux()).toBe(true);
  });

  test("returns false when TMUX is not set", async () => {
    delete process.env.TMUX;
    const { isRunningInsideTmux } = await import("./tmux.ts");
    expect(isRunningInsideTmux()).toBe(false);
  });
});

// ============================================================================
// Tests for functions using exec
// ============================================================================

describe("listTmuxPanes", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns null when tmux is not available", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("tmux") && _cmd === "which") {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listTmuxPanes } = await import("./tmux.ts");
    const result = await listTmuxPanes();
    expect(result).toBeNull();
  });

  test("returns parsed panes", async () => {
    const mockOutput = "%0\tshell\t/home/user\n%1\tclaude\t/tmp/wt-1\n%2\tother\t/tmp/wt-2";

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") {
        return { stdout: "/usr/bin/tmux\n" };
      }
      if (args.includes("list-panes")) {
        return { stdout: mockOutput };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listTmuxPanes } = await import("./tmux.ts");
    const result = await listTmuxPanes();
    expect(result).toEqual([
      { paneId: "%0", title: "shell", cwd: "/home/user" },
      { paneId: "%1", title: "claude", cwd: "/tmp/wt-1" },
      { paneId: "%2", title: "other", cwd: "/tmp/wt-2" },
    ]);
  });

  test("returns empty array for empty output", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") {
        return { stdout: "/usr/bin/tmux\n" };
      }
      if (args.includes("list-panes")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listTmuxPanes } = await import("./tmux.ts");
    const result = await listTmuxPanes();
    expect(result).toEqual([]);
  });

  test("returns null when list-panes fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") {
        return { stdout: "/usr/bin/tmux\n" };
      }
      if (args.includes("list-panes")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listTmuxPanes } = await import("./tmux.ts");
    const result = await listTmuxPanes();
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
      if (args.includes("split-window")) {
        return { stdout: "%42\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { splitPaneRight } = await import("./tmux.ts");
    const result = await splitPaneRight();

    expect(result).toBe("%42");
  });

  // CLI contract: verify the flags that tmux split-window requires for horizontal split with pane ID output
  test("passes -h (horizontal) and -P (print pane ID) flags", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("split-window")) {
        capturedArgs = args;
        return { stdout: "%0\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { splitPaneRight } = await import("./tmux.ts");
    await splitPaneRight();

    expect(capturedArgs).toContain("split-window");
    expect(capturedArgs).toContain("-h");
    expect(capturedArgs).toContain("-P");
  });
});

describe("sendKeys", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  // CLI contract: verify tmux send-keys uses -t (target pane) and -l (literal) flags
  test("passes -t and -l flags with pane ID and text", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("send-keys")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { sendKeys } = await import("./tmux.ts");
    await sendKeys("%42", "hello world");

    expect(capturedArgs).toContain("send-keys");
    expect(capturedArgs).toContain("-t");
    expect(capturedArgs).toContain("%42");
    expect(capturedArgs).toContain("-l");
    expect(capturedArgs).toContain("hello world");
  });
});

describe("sendCommand", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("sends text then Enter", async () => {
    const calls: string[][] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("send-keys")) {
        calls.push(args);
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { sendCommand } = await import("./tmux.ts");
    await sendCommand("%42", "ls -la");

    // First call sends the text with -l (literal)
    expect(calls[0]).toContain("-l");
    expect(calls[0]).toContain("ls -la");
    // Second call sends Enter
    expect(calls[1]).toContain("Enter");
  });
});

// activatePane is a side-effect-only function (no return value).
// We can only verify the CLI arguments passed to tmux; the actual pane focus
// change is a tmux side effect that cannot be observed in unit tests.
describe("activatePane", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  // CLI contract: verify tmux select-pane receives -t flag with target pane ID
  test("passes select-pane with -t flag and pane ID", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("select-pane")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { activatePane } = await import("./tmux.ts");
    await activatePane("%42");

    expect(capturedArgs).toContain("select-pane");
    expect(capturedArgs).toContain("-t");
    expect(capturedArgs).toContain("%42");
  });
});

describe("ensureTmuxAvailable", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    vi.resetModules();
    restoreEnv = saveEnv("TERM_PROGRAM");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("throws when tmux is not installed", async () => {
    const { ensureTmuxAvailable } = await import("./tmux.ts");
    const checkFn = async () => false;
    const isInsideFn = () => true;
    await expect(ensureTmuxAvailable(checkFn, "claude-worktree test '...'", isInsideFn)).rejects.toThrow(
      "tmux is not installed",
    );
  });

  test("throws when not running inside tmux", async () => {
    process.env.TERM_PROGRAM = "ghostty";
    const { ensureTmuxAvailable } = await import("./tmux.ts");
    const checkFn = async () => true;
    const isInsideFn = () => false;
    await expect(ensureTmuxAvailable(checkFn, "claude-worktree test '...'", isInsideFn)).rejects.toThrow(
      "current terminal is ghostty",
    );
  });

  test("does not throw when running inside tmux with CLI available", async () => {
    const { ensureTmuxAvailable } = await import("./tmux.ts");
    const checkFn = async () => true;
    const isInsideFn = () => true;
    await expect(ensureTmuxAvailable(checkFn, "claude-worktree test '...'", isInsideFn)).resolves.toBeUndefined();
  });
});

describe("closePane", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  // CLI contract: verify tmux kill-pane receives -t flag with target pane ID
  test("passes kill-pane with -t flag and pane ID", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("kill-pane")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { closePane } = await import("./tmux.ts");
    await closePane("%42");

    expect(capturedArgs).toContain("kill-pane");
    expect(capturedArgs).toContain("-t");
    expect(capturedArgs).toContain("%42");
  });
});

describe("createPane", () => {
  let restoreEnv: () => void;
  let restoreTmuxEnv: () => void;

  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
    restoreEnv = saveEnv("TMUX_PANE");
    restoreTmuxEnv = saveEnv("TMUX");
  });
  afterEach(() => {
    mockExecImpl.current = null;
    restoreEnv();
    restoreTmuxEnv();
  });

  test("inside tmux: creates pane via splitPaneRight and returns new paneId", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("split-window")) {
        return { stdout: "%99\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createPane } = await import("./tmux.ts");
    const result = await createPane({});

    expect(result).toBe("%99");
  });

  test("inside tmux: creates pane with keepFocus - activates original pane", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    process.env.TMUX_PANE = "%0";

    let activatedPaneId = "";
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("split-window")) {
        return { stdout: "%42\n" };
      }
      if (args.includes("select-pane")) {
        activatedPaneId = args[args.indexOf("-t") + 1];
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createPane } = await import("./tmux.ts");
    const result = await createPane({ keepFocus: true });

    expect(result).toBe("%42");
    expect(activatedPaneId).toBe("%0");
  });

  test("outside tmux: creates detached session", async () => {
    delete process.env.TMUX;

    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("new-session")) {
        capturedArgs = args;
        return { stdout: "%5\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createPane } = await import("./tmux.ts");
    const result = await createPane({});

    expect(result).toBe("%5");
    expect(capturedArgs).toContain("new-session");
    expect(capturedArgs).toContain("-d");
    expect(capturedArgs).toContain("-P");
  });

  test("outside tmux: ignores keepFocus option", async () => {
    delete process.env.TMUX;

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("new-session")) {
        return { stdout: "%5\n" };
      }
      if (args.includes("select-pane")) {
        throw new Error("select-pane should not be called outside tmux");
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createPane } = await import("./tmux.ts");
    const result = await createPane({ keepFocus: true });

    expect(result).toBe("%5");
  });
});

describe("getSessionForPane", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns session name for given pane ID", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("display-message")) {
        capturedArgs = args;
        return { stdout: "0\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getSessionForPane } = await import("./tmux.ts");
    const result = await getSessionForPane("%5");

    expect(result).toBe("0");
    expect(capturedArgs).toContain("display-message");
    expect(capturedArgs).toContain("-t");
    expect(capturedArgs).toContain("%5");
    expect(capturedArgs).toContain("#{session_name}");
  });
});
