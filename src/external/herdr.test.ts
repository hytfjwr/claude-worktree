import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createExecStub, saveEnv } from "../__test-utils__.ts";
import { getCurrentPaneId } from "./herdr.ts";

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

describe("isRunningInsideHerdr", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    vi.resetModules();
    restoreEnv = saveEnv("HERDR_ENV");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns true when HERDR_ENV is '1'", async () => {
    process.env.HERDR_ENV = "1";
    const { isRunningInsideHerdr } = await import("./herdr.ts");
    expect(isRunningInsideHerdr()).toBe(true);
  });

  test("returns false when HERDR_ENV is not set", async () => {
    delete process.env.HERDR_ENV;
    const { isRunningInsideHerdr } = await import("./herdr.ts");
    expect(isRunningInsideHerdr()).toBe(false);
  });

  test("returns false when HERDR_ENV is '0'", async () => {
    process.env.HERDR_ENV = "0";
    const { isRunningInsideHerdr } = await import("./herdr.ts");
    expect(isRunningInsideHerdr()).toBe(false);
  });
});

describe("getCurrentPaneId", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveEnv("HERDR_PANE_ID");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("retrieves from environment variable", () => {
    process.env.HERDR_PANE_ID = "w1B:p1";
    expect(getCurrentPaneId()).toBe("w1B:p1");
  });

  test("returns undefined when not set", () => {
    delete process.env.HERDR_PANE_ID;
    expect(getCurrentPaneId()).toBeUndefined();
  });
});

// ============================================================================
// Tests for functions using exec
// ============================================================================

describe("checkHerdrAvailable", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns true when which herdr exits 0", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which" && args.includes("herdr")) {
        return { stdout: "/usr/local/bin/herdr\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { checkHerdrAvailable } = await import("./herdr.ts");
    expect(await checkHerdrAvailable()).toBe(true);
  });

  test("returns false when which herdr exits 1", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which" && args.includes("herdr")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { checkHerdrAvailable } = await import("./herdr.ts");
    expect(await checkHerdrAvailable()).toBe(false);
  });

  test("returns false when exec throws", async () => {
    mockExecImpl.current = () => {
      throw new Error("spawn failed");
    };

    const { checkHerdrAvailable } = await import("./herdr.ts");
    expect(await checkHerdrAvailable()).toBe(false);
  });
});

describe("isHerdrServerRunning", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns true when status is running", async () => {
    const output = ["status: running", "version: 0.8.2", "protocol: 20", "compatible: yes", "socket: /x"].join("\n");
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("status")) {
        return { stdout: output };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isHerdrServerRunning } = await import("./herdr.ts");
    expect(await isHerdrServerRunning()).toBe(true);
  });

  test("returns false when status is not running", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("status")) {
        return { stdout: "status: not running\nsocket: /x" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isHerdrServerRunning } = await import("./herdr.ts");
    expect(await isHerdrServerRunning()).toBe(false);
  });

  test("returns false when exit code is non-zero", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("status")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isHerdrServerRunning } = await import("./herdr.ts");
    expect(await isHerdrServerRunning()).toBe(false);
  });
});

describe("listHerdrPanes", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  // Raw JSON text (rather than a JS object) so that field names mirroring the
  // herdr CLI's snake_case schema don't trip up the camelCase lint rule.
  const paneListResponse = `{
    "id": "cli:pane:list",
    "result": {
      "type": "pane_list",
      "panes": [
        {
          "agent": "claude",
          "agent_status": "idle",
          "cwd": "/Users/me/Dev/dotfiles",
          "focused": false,
          "foreground_cwd": "/Users/me/Dev/dotfiles",
          "pane_id": "wD:p1",
          "revision": 3,
          "tab_id": "wD:t1",
          "terminal_id": "term_65a10a20c03c11",
          "terminal_title": "✳ Fix setup script",
          "terminal_title_stripped": "Fix setup script",
          "workspace_id": "wD"
        },
        {
          "agent": null,
          "agent_status": "bogus",
          "focused": true,
          "foreground_cwd": "/tmp/other",
          "pane_id": "wE:p1",
          "revision": 1,
          "tab_id": "wE:t1",
          "terminal_id": "term_other",
          "terminal_title": "Other title",
          "workspace_id": "wE"
        }
      ]
    }
  }`;

  test("returns parsed panes", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") return { stdout: "/usr/local/bin/herdr\n" };
      if (args[0] === "pane" && args[1] === "list") {
        return { stdout: paneListResponse };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listHerdrPanes } = await import("./herdr.ts");
    const result = await listHerdrPanes();

    expect(result).toEqual([
      {
        paneId: "wD:p1",
        workspaceId: "wD",
        title: "Fix setup script",
        cwd: "/Users/me/Dev/dotfiles",
        agentStatus: "idle",
      },
      {
        paneId: "wE:p1",
        workspaceId: "wE",
        title: "Other title",
        cwd: "/tmp/other",
        agentStatus: "unknown",
      },
    ]);
  });

  test("passes CLI contract args ['pane', 'list']", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") return { stdout: "/usr/local/bin/herdr\n" };
      if (args[0] === "pane") {
        capturedArgs = args;
        return { stdout: '{"result":{"panes":[]}}' };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listHerdrPanes } = await import("./herdr.ts");
    await listHerdrPanes();

    expect(capturedArgs).toEqual(["pane", "list"]);
  });

  test("returns null when which herdr fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") return { stdout: "", exitCode: 1 };
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listHerdrPanes } = await import("./herdr.ts");
    expect(await listHerdrPanes()).toBeNull();
  });

  test("returns null when pane list exits non-zero", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") return { stdout: "/usr/local/bin/herdr\n" };
      if (args[0] === "pane") return { stdout: "", exitCode: 1 };
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listHerdrPanes } = await import("./herdr.ts");
    expect(await listHerdrPanes()).toBeNull();
  });

  test("returns null on invalid JSON", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") return { stdout: "/usr/local/bin/herdr\n" };
      if (args[0] === "pane") return { stdout: "not json" };
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listHerdrPanes } = await import("./herdr.ts");
    expect(await listHerdrPanes()).toBeNull();
  });

  test("returns null when result.panes is missing", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which") return { stdout: "/usr/local/bin/herdr\n" };
      if (args[0] === "pane") return { stdout: '{"result":{}}' };
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listHerdrPanes } = await import("./herdr.ts");
    expect(await listHerdrPanes()).toBeNull();
  });
});

describe("createWorkspace", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  const workspaceCreateResponse = `{
    "id": "cli:workspace:create",
    "result": {
      "type": "workspace_created",
      "workspace": {
        "workspace_id": "w1B",
        "number": 6,
        "label": "app/feature",
        "focused": false,
        "pane_count": 1,
        "tab_count": 1,
        "active_tab_id": "w1B:t1",
        "agent_status": "unknown"
      },
      "tab": {
        "tab_id": "w1B:t1",
        "workspace_id": "w1B",
        "number": 1,
        "label": "app/feature",
        "focused": true,
        "pane_count": 1,
        "agent_status": "unknown"
      },
      "root_pane": {
        "pane_id": "w1B:p1",
        "terminal_id": "term_x",
        "workspace_id": "w1B",
        "tab_id": "w1B:t1",
        "focused": true,
        "agent_status": "unknown",
        "revision": 1
      }
    }
  }`;

  test("passes --cwd and --label when provided", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: workspaceCreateResponse };
    });

    const { createWorkspace } = await import("./herdr.ts");
    await createWorkspace({ cwd: "/wt", label: "repo/feature" });

    expect(capturedArgs).toEqual(["workspace", "create", "--no-focus", "--cwd", "/wt", "--label", "repo/feature"]);
  });

  test("omits --cwd and --label when not provided", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: workspaceCreateResponse };
    });

    const { createWorkspace } = await import("./herdr.ts");
    await createWorkspace({});

    expect(capturedArgs).toEqual(["workspace", "create", "--no-focus"]);
  });

  test("returns paneId and workspaceId from response", async () => {
    mockExecImpl.current = createExecStub(() => ({ stdout: workspaceCreateResponse }));

    const { createWorkspace } = await import("./herdr.ts");
    const result = await createWorkspace({});

    expect(result).toEqual({ paneId: "w1B:p1", workspaceId: "w1B" });
  });

  test("throws with server error details on failure", async () => {
    const errorBody =
      '{"id":"cli:workspace:create","error":{"code":"server_not_running","message":"no herdr server is running"}}';
    mockExecImpl.current = createExecStub(() => ({ stdout: "", stderr: errorBody, exitCode: 1 }));

    const { createWorkspace } = await import("./herdr.ts");
    await expect(createWorkspace({})).rejects.toThrow("server_not_running: no herdr server is running");
  });

  test("throws unexpected response error when root_pane is missing", async () => {
    mockExecImpl.current = createExecStub(() => ({ stdout: '{"result":{"workspace":{"workspace_id":"w1B"}}}' }));

    const { createWorkspace } = await import("./herdr.ts");
    await expect(createWorkspace({})).rejects.toThrow("herdr workspace create returned an unexpected response");
  });
});

describe("isShellReady", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  const readyResponse = `{
    "id": "cli:pane:process_info",
    "result": {
      "type": "pane_process_info",
      "process_info": {
        "pane_id": "wG:p1",
        "shell_pid": 2896,
        "tty": "/dev/ttys012",
        "foreground_processes": [{ "pid": 2896, "name": "zsh", "argv0": "zsh" }]
      }
    }
  }`;

  test("returns true when the shell is the only foreground process", async () => {
    mockExecImpl.current = createExecStub(() => ({ stdout: readyResponse }));

    const { isShellReady } = await import("./herdr.ts");
    expect(await isShellReady("wG:p1")).toBe(true);
  });

  test("returns false when the foreground process differs from the shell", async () => {
    const response =
      '{"result":{"process_info":{"shell_pid":2896,"foreground_processes":[{"pid":7434,"name":"2.1.248","argv0":"claude"}]}}}';
    mockExecImpl.current = createExecStub(() => ({ stdout: response }));

    const { isShellReady } = await import("./herdr.ts");
    expect(await isShellReady("wG:p1")).toBe(false);
  });

  test("returns false when foreground_processes is empty", async () => {
    const response = '{"result":{"process_info":{"shell_pid":2896,"foreground_processes":[]}}}';
    mockExecImpl.current = createExecStub(() => ({ stdout: response }));

    const { isShellReady } = await import("./herdr.ts");
    expect(await isShellReady("wG:p1")).toBe(false);
  });

  test("returns false when exit code is non-zero", async () => {
    mockExecImpl.current = createExecStub(() => ({ stdout: "", exitCode: 1 }));

    const { isShellReady } = await import("./herdr.ts");
    expect(await isShellReady("wG:p1")).toBe(false);
  });
});

describe("waitForShellReady", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  const claudeInForeground = '{"result":{"process_info":{"shell_pid":2896,"foreground_processes":[{"pid":7434}]}}}';
  const shellInForeground = '{"result":{"process_info":{"shell_pid":2896,"foreground_processes":[{"pid":2896}]}}}';

  test("resolves after the shell becomes ready, sleeping once between polls", async () => {
    let callCount = 0;
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("process-info")) {
        callCount++;
        return { stdout: callCount === 1 ? claudeInForeground : shellInForeground };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const sleep = vi.fn(async () => {});
    const { waitForShellReady } = await import("./herdr.ts");
    await waitForShellReady("w1B:p1", { sleep });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(2);
  });

  test("rejects with a timeout message when the shell never becomes ready", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("process-info")) {
        return { stdout: claudeInForeground };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { waitForShellReady } = await import("./herdr.ts");
    await expect(waitForShellReady("w1B:p1", { timeoutMs: 10, intervalMs: 5 })).rejects.toThrow(
      /w1B:p1 did not reach an interactive shell prompt/,
    );
  });
});

describe("runCommand", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("passes pane id and command as a single argument", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: '{"result":{}}' };
    });

    const { runCommand } = await import("./herdr.ts");
    await runCommand("w1B:p1", "cd /wt && claude");

    expect(capturedArgs).toEqual(["pane", "run", "w1B:p1", "cd /wt && claude"]);
  });

  test("throws with error details on failure", async () => {
    mockExecImpl.current = createExecStub(() => ({ stdout: "", stderr: "pane_not_found", exitCode: 1 }));

    const { runCommand } = await import("./herdr.ts");
    await expect(runCommand("w1B:p1", "ls")).rejects.toThrow("herdr pane run failed");
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

  test("waits for the shell to be ready before running the command", async () => {
    const order: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("process-info")) {
        order.push("process-info");
        return { stdout: '{"result":{"process_info":{"shell_pid":2896,"foreground_processes":[{"pid":2896}]}}}' };
      }
      if (args[0] === "pane" && args[1] === "run") {
        order.push("run");
        return { stdout: '{"result":{}}' };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { sendCommand } = await import("./herdr.ts");
    await sendCommand("w1B:p1", "cd /wt && claude");

    expect(order).toEqual(["process-info", "run"]);
  });
});

describe("closeWorkspace", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("passes workspace id to workspace close", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: "" };
    });

    const { closeWorkspace } = await import("./herdr.ts");
    await closeWorkspace("w1B");

    expect(capturedArgs).toEqual(["workspace", "close", "w1B"]);
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

  test("passes pane id to pane close", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: "" };
    });

    const { closePane } = await import("./herdr.ts");
    await closePane("w1B:p1");

    expect(capturedArgs).toEqual(["pane", "close", "w1B:p1"]);
  });
});

describe("createPane", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("forwards cwd and label without --focus", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: '{"result":{"workspace":{"workspace_id":"w1B"},"root_pane":{"pane_id":"w1B:p1"}}}' };
    });

    const { createPane } = await import("./herdr.ts");
    const result = await createPane({ keepFocus: true, cwd: "/wt", label: "L" });

    expect(capturedArgs).toContain("--cwd");
    expect(capturedArgs).toContain("/wt");
    expect(capturedArgs).toContain("--label");
    expect(capturedArgs).toContain("L");
    expect(capturedArgs).not.toContain("--focus");
    expect(result).toEqual({ paneId: "w1B:p1", workspaceId: "w1B" });
  });
});

describe("closeCreatedPane", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("closes the workspace when workspaceId is present", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: "" };
    });

    const { closeCreatedPane } = await import("./herdr.ts");
    await closeCreatedPane({ paneId: "w1B:p1", workspaceId: "w1B" });

    expect(capturedArgs).toEqual(["workspace", "close", "w1B"]);
  });

  test("closes the pane when workspaceId is absent", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      capturedArgs = args;
      return { stdout: "" };
    });

    const { closeCreatedPane } = await import("./herdr.ts");
    await closeCreatedPane({ paneId: "w1B:p1" });

    expect(capturedArgs).toEqual(["pane", "close", "w1B:p1"]);
  });
});
