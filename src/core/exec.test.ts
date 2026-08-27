import { spawn } from "node:child_process";
import { describe, expect, test, vi } from "vitest";

import { ExecError, escalateKill, exec, SIGKILL_GRACE_MS } from "./exec.ts";

// ============================================================================
// Basic execution tests
// ============================================================================

describe("exec", () => {
  test("text() returns stdout as string", async () => {
    const text = await exec("echo", ["hello"]).text();
    expect(text.trim()).toBe("hello");
  });

  test("result.text() returns stdout as string", async () => {
    const result = await exec("echo", ["hello"]).nothrow().quiet();
    expect(result.text().trim()).toBe("hello");
  });

  test("stdout buffer is accessible", async () => {
    const result = await exec("echo", ["hello"]).nothrow().quiet();
    expect(result.stdout).toBeInstanceOf(Buffer);
    expect(result.stdout.toString().trim()).toBe("hello");
  });

  test("preserves arguments with spaces", async () => {
    const text = await exec("echo", ["hello world"]).text();
    expect(text.trim()).toBe("hello world");
  });

  test("handles empty stdout", async () => {
    const text = await exec("true", []).text();
    expect(text).toBe("");
  });
});

// ============================================================================
// Exit code tests
// ============================================================================

describe("exitCode", () => {
  test("exitCode is 0 for successful command", async () => {
    const result = await exec("true", []).nothrow().quiet();
    expect(result.exitCode).toBe(0);
  });

  test("exitCode is non-zero for failed command", async () => {
    const result = await exec("false", []).nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
  });

  test("exitCode reflects specific exit code", async () => {
    const result = await exec("sh", ["-c", "exit 42"]).nothrow().quiet();
    expect(result.exitCode).toBe(42);
  });
});

// ============================================================================
// Error handling tests
// ============================================================================

describe("error handling", () => {
  test("throws ExecError on non-zero exit without nothrow", async () => {
    try {
      await exec("false", []).quiet();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExecError);
      expect((err as ExecError).exitCode).not.toBe(0);
    }
  });

  test("ExecError contains stdout and stderr", async () => {
    try {
      await exec("sh", ["-c", "echo out && echo err >&2 && exit 1"]).quiet();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExecError);
      const execErr = err as ExecError;
      expect(execErr.text().trim()).toBe("out");
      expect(execErr.stderr.toString().trim()).toBe("err");
    }
  });

  test("ExecError message includes command info", async () => {
    try {
      await exec("sh", ["-c", "exit 1"]).quiet();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExecError);
      expect((err as ExecError).message).toContain("exit code 1");
      expect((err as ExecError).message).toContain("sh");
    }
  });

  test("rejects on invalid command", async () => {
    try {
      await exec("nonexistent-command-12345", []).quiet();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});

// ============================================================================
// nothrow tests
// ============================================================================

describe("nothrow", () => {
  test("does not throw on non-zero exit", async () => {
    const result = await exec("false", []).nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
  });

  test("still returns result on success", async () => {
    const result = await exec("echo", ["ok"]).nothrow().quiet();
    expect(result.exitCode).toBe(0);
    expect(result.text().trim()).toBe("ok");
  });
});

// ============================================================================
// quiet tests
// ============================================================================

describe("quiet", () => {
  test("captures stdout without terminal output", async () => {
    const result = await exec("echo", ["quiet-test"]).nothrow().quiet();
    expect(result.text().trim()).toBe("quiet-test");
  });

  test("captures stderr without terminal output", async () => {
    const result = await exec("sh", ["-c", "echo err >&2"]).nothrow().quiet();
    expect(result.stderr.toString().trim()).toBe("err");
  });
});

// ============================================================================
// cwd tests
// ============================================================================

describe("cwd", () => {
  test("sets working directory", async () => {
    const result = await exec("pwd", []).cwd("/tmp").quiet();
    // On macOS, /tmp is a symlink to /private/tmp
    expect(result.text().trim()).toMatch(/\/(private\/)?tmp$/);
  });

  test("cwd with nothrow and quiet", async () => {
    const result = await exec("pwd", []).cwd("/tmp").nothrow().quiet();
    expect(result.exitCode).toBe(0);
    expect(result.text().trim()).toMatch(/\/(private\/)?tmp$/);
  });
});

// ============================================================================
// stderr tests
// ============================================================================

describe("stderr", () => {
  test("stderr is captured as Buffer", async () => {
    const result = await exec("sh", ["-c", "echo error-output >&2"]).nothrow().quiet();
    expect(result.stderr).toBeInstanceOf(Buffer);
    expect(result.stderr.toString().trim()).toBe("error-output");
  });

  test("stderr and stdout are captured independently", async () => {
    const result = await exec("sh", ["-c", "echo out && echo err >&2"]).nothrow().quiet();
    expect(result.text().trim()).toBe("out");
    expect(result.stderr.toString().trim()).toBe("err");
  });
});

// ============================================================================
// Chaining pattern tests
// ============================================================================

describe("chaining patterns", () => {
  test(".nothrow().quiet() - common pattern for exit code checks", async () => {
    const result = await exec("sh", ["-c", "echo out && echo err >&2 && exit 1"]).nothrow().quiet();
    expect(result.exitCode).toBe(1);
    expect(result.text().trim()).toBe("out");
    expect(result.stderr.toString().trim()).toBe("err");
  });

  test(".cwd().nothrow() - pattern for hook execution", async () => {
    const result = await exec("pwd", []).cwd("/tmp").nothrow();
    expect(result.exitCode).toBe(0);
    expect(result.text().trim()).toMatch(/\/(private\/)?tmp$/);
  });

  test(".cwd().nothrow().quiet() - pattern for quiet hook execution", async () => {
    const result = await exec("pwd", []).cwd("/tmp").nothrow().quiet();
    expect(result.exitCode).toBe(0);
    expect(result.text().trim()).toMatch(/\/(private\/)?tmp$/);
  });

  test(".text() shortcut on builder", async () => {
    const text = (await exec("echo", ["hello"]).text()).trim();
    expect(text).toBe("hello");
  });
});

// ============================================================================
// timeout tests
// ============================================================================

describe("timeout", () => {
  test("command completes before timeout - returns result", async () => {
    const result = await exec("echo", ["hello"]).timeout(5000).nothrow().quiet();
    expect(result.exitCode).toBe(0);
    expect(result.text().trim()).toBe("hello");
  });

  test("command exceeds timeout - throws ExecError with exit code 124", async () => {
    try {
      await exec("sleep", ["10"]).timeout(100).quiet();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExecError);
      const execErr = err as ExecError;
      expect(execErr.exitCode).toBe(124);
      expect(execErr.message).toContain("timed out after 100ms");
    }
  });

  test("timeout works with .text()", async () => {
    try {
      await exec("sleep", ["10"]).timeout(100).text();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExecError);
      expect((err as ExecError).exitCode).toBe(124);
    }
  });

  test("timeout with nothrow still throws on timeout", async () => {
    // Timeout should always throw, even with nothrow (nothrow only suppresses non-zero exit codes)
    try {
      await exec("sleep", ["10"]).timeout(100).nothrow().quiet();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExecError);
      expect((err as ExecError).exitCode).toBe(124);
    }
  });

  test("chaining order: .timeout().nothrow().quiet()", async () => {
    const result = await exec("echo", ["ok"]).timeout(5000).nothrow().quiet();
    expect(result.text().trim()).toBe("ok");
  });
});

// ============================================================================
// timeout escalation tests
// ============================================================================

describe("timeout escalation", () => {
  test("SIGKILL_GRACE_MS is 5000ms", () => {
    expect(SIGKILL_GRACE_MS).toBe(5000);
  });

  test("settles and kills a child that ignores SIGTERM", async () => {
    // A pure-sh child: `trap` is installed before the PID is printed, and sh starts
    // far faster than a node process, so this stays reliable under parallel test load.
    const script = 'trap "" TERM; echo $$; while :; do sleep 0.1; done';

    let error: unknown;
    try {
      await exec("sh", ["-c", script]).quiet().timeout(2000, 200);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ExecError);
    const pidLine = (error as ExecError).text().trim().split("\n")[0];
    const pid = Number(pidLine);
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    expect((error as ExecError).message).toMatch(/timed out/);

    // Poll until the child is gone (generous budget so parallel load cannot flake it)
    let exited = false;
    for (let i = 0; i < 60; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        exited = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(exited).toBe(true);
  }, 30000);

  test("clears the SIGKILL timer when the child exits on its own", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const proc = spawn("sh", ["-c", "sleep 0.05"]);
    escalateKill(proc, 60_000);
    await new Promise<void>((resolve) => proc.once("close", () => resolve()));
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  }, 15000);
});

// ============================================================================
// Real command tests (using git, matching existing test patterns)
// ============================================================================

describe("real commands", () => {
  test("git rev-parse --show-toplevel", async () => {
    const repoRoot = (await exec("git", ["rev-parse", "--show-toplevel"]).text()).trim();
    expect(repoRoot).toBeTruthy();
    expect(repoRoot).not.toContain("\n");
  });

  test("git branch --show-current", async () => {
    const branch = (await exec("git", ["branch", "--show-current"]).text()).trim();
    expect(branch).toBeTruthy();
  });

  test("git status with nothrow and quiet", async () => {
    const result = await exec("git", ["status", "--porcelain"]).nothrow().quiet();
    expect(result.exitCode).toBe(0);
    // text() should return a string (may be empty if clean)
    expect(typeof result.text()).toBe("string");
  });

  test("git show-ref for branch existence check", async () => {
    // Check if current branch exists (should always be true)
    const branch = (await exec("git", ["branch", "--show-current"]).text()).trim();
    const result = await exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
      .nothrow()
      .quiet();
    expect(result.exitCode).toBe(0);
  });
});
