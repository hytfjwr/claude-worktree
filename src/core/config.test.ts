import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ProjectConfig } from "../types/index.ts";
import {
  buildHookCommand,
  DEFAULT_HOOK_TIMEOUT,
  loadProjectConfig,
  resolveHookTimeout,
  runHook,
  SIGKILL_GRACE_MS,
  validateProjectConfig,
} from "./config.ts";

const testCwd = tmpdir();

describe("buildHookCommand", () => {
  test("replaces {path}", () => {
    const result = buildHookCommand("cd {path} && make setup", {
      path: "/path/to/worktree",
    });
    expect(result).toBe("cd /path/to/worktree && make setup");
  });

  test("replaces {slot} with number", () => {
    const result = buildHookCommand("docker-compose -p app-{slot} up -d", {
      path: "/path",
      slot: 3,
    });
    expect(result).toBe("docker-compose -p app-3 up -d");
  });

  test("replaces {slot} with empty string when undefined", () => {
    const result = buildHookCommand("echo {slot}", { path: "/path" });
    expect(result).toBe("echo ");
  });

  test("multiple {path} occurrences", () => {
    const result = buildHookCommand("echo {path} && ls {path}", {
      path: "/tmp/wt",
    });
    expect(result).toBe("echo /tmp/wt && ls /tmp/wt");
  });

  test("simultaneous replacement of both variables", () => {
    const result = buildHookCommand("docker-compose -p {slot} -f {path}/docker-compose.yml up", {
      path: "/app",
      slot: 5,
    });
    expect(result).toBe("docker-compose -p 5 -f /app/docker-compose.yml up");
  });

  test("template without variables returns as-is", () => {
    const result = buildHookCommand("make setup", { path: "/path" });
    expect(result).toBe("make setup");
  });

  test("rejects path containing shell metacharacters", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/$(rm -rf /)" })).toThrow("Invalid path in hook variables");
  });

  test("rejects path containing backticks", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/`whoami`" })).toThrow("Invalid path in hook variables");
  });

  test("rejects path containing semicolons", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp; rm -rf /" })).toThrow("Invalid path in hook variables");
  });

  test("rejects path containing pipes", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp | cat /etc/passwd" })).toThrow(
      "Invalid path in hook variables",
    );
  });

  test("rejects path containing glob wildcards", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/*" })).toThrow("Invalid path in hook variables");
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/?" })).toThrow("Invalid path in hook variables");
  });

  test("rejects path containing tilde", () => {
    expect(() => buildHookCommand("cd {path}", { path: "~/tmp" })).toThrow("Invalid path in hook variables");
  });

  test("rejects path containing quotes", () => {
    expect(() => buildHookCommand("cd {path}", { path: '/tmp/"foo"' })).toThrow("Invalid path in hook variables");
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/'foo'" })).toThrow("Invalid path in hook variables");
  });

  test("rejects path containing brackets", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/[a]" })).toThrow("Invalid path in hook variables");
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/{a,b}" })).toThrow("Invalid path in hook variables");
  });

  test("rejects path containing spaces", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/my dir" })).toThrow("Invalid path in hook variables");
  });

  test("rejects empty path", () => {
    expect(() => buildHookCommand("cd {path}", { path: "" })).toThrow("Path must not be empty");
  });

  test("rejects path starting with hyphen", () => {
    expect(() => buildHookCommand("cd {path}", { path: "-help" })).toThrow("Path must not start with '-'");
    expect(() => buildHookCommand("cd {path}", { path: "--version" })).toThrow("Path must not start with '-'");
  });

  test("error message includes the invalid path value", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/$bad" })).toThrow('"/tmp/$bad"');
  });

  test("allows normal paths (hyphens, slashes, dots, underscores)", () => {
    const result = buildHookCommand("cd {path}", {
      path: "/home/user/my-project_v2/work.tree",
    });
    expect(result).toBe("cd /home/user/my-project_v2/work.tree");
  });

  test("rejects slot outside valid range", () => {
    expect(() => buildHookCommand("echo {slot}", { path: "/path", slot: 0 })).toThrow(
      "Invalid slot: must be an integer between 1-9",
    );
    expect(() => buildHookCommand("echo {slot}", { path: "/path", slot: 10 })).toThrow(
      "Invalid slot: must be an integer between 1-9",
    );
    expect(() => buildHookCommand("echo {slot}", { path: "/path", slot: -1 })).toThrow(
      "Invalid slot: must be an integer between 1-9",
    );
    expect(() => buildHookCommand("echo {slot}", { path: "/path", slot: 1.5 })).toThrow(
      "Invalid slot: must be an integer between 1-9",
    );
  });

  test("allows valid slot values 1-9", () => {
    for (let i = 1; i <= 9; i++) {
      const result = buildHookCommand("echo {slot}", { path: "/path", slot: i });
      expect(result).toBe(`echo ${i}`);
    }
  });
});

describe("resolveHookTimeout", () => {
  test("returns hook-specific timeout when set (postCreate)", () => {
    const config: ProjectConfig = { postCreateTimeout: 300, hookTimeout: 120 };
    expect(resolveHookTimeout("postCreate", config)).toBe(300);
  });

  test("returns hook-specific timeout when set (preClean)", () => {
    const config: ProjectConfig = { preCleanTimeout: 60, hookTimeout: 120 };
    expect(resolveHookTimeout("preClean", config)).toBe(60);
  });

  test("returns hook-specific timeout when set (postClean)", () => {
    const config: ProjectConfig = { postCleanTimeout: 90, hookTimeout: 120 };
    expect(resolveHookTimeout("postClean", config)).toBe(90);
  });

  test("falls back to hookTimeout when hook-specific value is not set", () => {
    const config: ProjectConfig = { hookTimeout: 120 };
    expect(resolveHookTimeout("postCreate", config)).toBe(120);
    expect(resolveHookTimeout("preClean", config)).toBe(120);
    expect(resolveHookTimeout("postClean", config)).toBe(120);
  });

  test("returns DEFAULT_HOOK_TIMEOUT when nothing is configured", () => {
    const config: ProjectConfig = {};
    expect(resolveHookTimeout("postCreate", config)).toBe(DEFAULT_HOOK_TIMEOUT);
    expect(resolveHookTimeout("preClean", config)).toBe(DEFAULT_HOOK_TIMEOUT);
    expect(resolveHookTimeout("postClean", config)).toBe(DEFAULT_HOOK_TIMEOUT);
  });

  test("returns DEFAULT_HOOK_TIMEOUT when config is null", () => {
    expect(resolveHookTimeout("postCreate", null)).toBe(DEFAULT_HOOK_TIMEOUT);
    expect(resolveHookTimeout("preClean", null)).toBe(DEFAULT_HOOK_TIMEOUT);
    expect(resolveHookTimeout("postClean", null)).toBe(DEFAULT_HOOK_TIMEOUT);
  });
});

describe("validateProjectConfig", () => {
  test("returns no errors for valid empty config", () => {
    expect(validateProjectConfig({})).toEqual([]);
  });

  test("returns no errors for valid full config", () => {
    const config = {
      maxWorktrees: 5,
      hookTimeout: 600,
      postCreate: "cd {path} && make setup",
      postCreateTimeout: 300,
      preClean: "cd {path} && make teardown",
      preCleanTimeout: 120,
      postClean: "echo done",
      postCleanTimeout: 60,
    };
    expect(validateProjectConfig(config)).toEqual([]);
  });

  test("rejects non-object values", () => {
    expect(validateProjectConfig(null)).toEqual(["Config must be a JSON object"]);
    expect(validateProjectConfig("string")).toEqual(["Config must be a JSON object"]);
    expect(validateProjectConfig(42)).toEqual(["Config must be a JSON object"]);
    expect(validateProjectConfig([])).toEqual(["Config must be a JSON object"]);
  });

  test("rejects non-integer maxWorktrees", () => {
    expect(validateProjectConfig({ maxWorktrees: 1.5 })).toEqual([
      "maxWorktrees must be a non-negative integer, got 1.5",
    ]);
  });

  test("rejects non-number maxWorktrees", () => {
    expect(validateProjectConfig({ maxWorktrees: "five" })).toEqual([
      'maxWorktrees must be a non-negative integer, got "five"',
    ]);
  });

  test("allows zero maxWorktrees", () => {
    expect(validateProjectConfig({ maxWorktrees: 0 })).toEqual([]);
  });

  test("rejects negative maxWorktrees", () => {
    expect(validateProjectConfig({ maxWorktrees: -1 })).toEqual([
      "maxWorktrees must be a non-negative integer, got -1",
    ]);
  });

  test("rejects non-number timeout fields", () => {
    const errors = validateProjectConfig({ hookTimeout: "slow", postCreateTimeout: true });
    expect(errors).toContain('hookTimeout must be a positive number, got "slow"');
    expect(errors).toContain("postCreateTimeout must be a positive number, got true");
  });

  test("rejects zero and negative timeout fields", () => {
    expect(validateProjectConfig({ hookTimeout: 0 })).toEqual(["hookTimeout must be a positive number, got 0"]);
    expect(validateProjectConfig({ preCleanTimeout: -10 })).toEqual([
      "preCleanTimeout must be a positive number, got -10",
    ]);
  });

  test("rejects non-string hook commands", () => {
    const errors = validateProjectConfig({ postCreate: 123, preClean: false });
    expect(errors).toContain("postCreate must be a string, got 123");
    expect(errors).toContain("preClean must be a string, got false");
  });

  test("collects multiple errors at once", () => {
    const errors = validateProjectConfig({
      maxWorktrees: "many",
      hookTimeout: null,
      postCreate: 42,
    });
    expect(errors).toHaveLength(3);
  });

  test("allows maxWorktrees of 1", () => {
    expect(validateProjectConfig({ maxWorktrees: 1 })).toEqual([]);
  });

  test("allows fractional timeout values", () => {
    expect(validateProjectConfig({ hookTimeout: 0.5 })).toEqual([]);
  });
});

describe("loadProjectConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns null when config file does not exist", async () => {
    const result = await loadProjectConfig(tempDir);
    expect(result).toBeNull();
  });

  test("returns null and warns on JSON parse error", async () => {
    const warnSpy = vi.spyOn(await import("../ui/logger.ts"), "logWarn").mockImplementation(() => {});
    await writeFile(join(tempDir, ".claude-worktree.json"), "not valid json", "utf-8");

    const result = await loadProjectConfig(tempDir);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse .claude-worktree.json"));
  });

  test("returns null and warns on validation error", async () => {
    const warnSpy = vi.spyOn(await import("../ui/logger.ts"), "logWarn").mockImplementation(() => {});
    await writeFile(join(tempDir, ".claude-worktree.json"), JSON.stringify({ maxWorktrees: "bad" }), "utf-8");

    const result = await loadProjectConfig(tempDir);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid .claude-worktree.json"));
  });

  test("returns ProjectConfig for valid config file", async () => {
    const config = { maxWorktrees: 5, postCreate: "echo setup" };
    await writeFile(join(tempDir, ".claude-worktree.json"), JSON.stringify(config), "utf-8");

    const result = await loadProjectConfig(tempDir);
    expect(result).toEqual(config);
  });
});

describe("runHook timeout", () => {
  const sleepCmd = 'node -e "setTimeout(() => {}, 10000)"';

  test("throws timeout error when command exceeds timeout", async () => {
    await expect(runHook(sleepCmd, testCwd, { timeout: 0.05 })).rejects.toThrow(
      `Hook command timed out after 0.05s: ${sleepCmd}`,
    );
  });

  test("completes successfully within timeout", async () => {
    await expect(runHook("echo ok", testCwd, { timeout: 10 })).resolves.toBeUndefined();
  });

  test("throws timeout error with onLine mode", async () => {
    const lines: string[] = [];
    await expect(runHook(sleepCmd, testCwd, { timeout: 0.05, onLine: (line) => lines.push(line) })).rejects.toThrow(
      `Hook command timed out after 0.05s: ${sleepCmd}`,
    );
  });

  test(
    "kills SIGTERM-resistant process via SIGKILL escalation (onLine mode)",
    async () => {
      // Use 'exec' so sh replaces itself with node; without it, sh may fork
      // on Linux, causing SIGTERM to kill sh while node survives as an orphan.
      const trapCmd = `exec node -e "console.log(process.pid); process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000)"`;
      const lines: string[] = [];
      await expect(runHook(trapCmd, testCwd, { timeout: 0.1, onLine: (line) => lines.push(line) })).rejects.toThrow(
        /timed out/,
      );

      const pidLine = lines.find((line) => /^\d+$/.test(line));
      expect(pidLine, "expected hook output to contain a PID line").toBeDefined();
      const pid = Number(pidLine);
      expect(Number.isNaN(pid)).toBe(false);

      // SIGKILL is sent after SIGKILL_GRACE_MS; wait for it to take effect
      await new Promise((resolve) => setTimeout(resolve, SIGKILL_GRACE_MS + 1000));

      // After the grace period, the process should no longer exist
      expect(() => process.kill(pid, 0)).toThrow();
    },
    SIGKILL_GRACE_MS + 5000,
  );
});

describe("SIGKILL_GRACE_MS", () => {
  test("is 5000ms", () => {
    expect(SIGKILL_GRACE_MS).toBe(5000);
  });
});

describe("runHook onLine", () => {
  test("calls onLine for each output line", async () => {
    const lines: string[] = [];
    await runHook('echo "line1"; echo "line2"; echo "line3"', testCwd, {
      onLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  test("streams stderr to onLine as well", async () => {
    const lines: string[] = [];
    await runHook('echo "stdout-line"; echo "stderr-line" >&2', testCwd, {
      onLine: (line) => lines.push(line),
    });
    expect(lines).toContain("stdout-line");
    expect(lines).toContain("stderr-line");
  });
});
