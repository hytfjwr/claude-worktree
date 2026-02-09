import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import type { HookVars, ProjectConfig } from "../types";
import { DEFAULT_HOOK_TIMEOUT, resolveHookTimeout, runHook } from "./config";

const testCwd = tmpdir();

// ============================================================================
// Pure function tests (no mocks needed)
// buildHookCommand is a pure function, so we test the logic inline
// to avoid being affected by mock.module
// ============================================================================

// Same logic as validateHookVars (for pure function testing)
function validateHookVars(vars: HookVars): void {
  const shellMetachars = /[;&|`$()<>\n\r]/;
  if (shellMetachars.test(vars.path)) {
    throw new Error(`Invalid hook variable: path "${vars.path}" contains shell metacharacters`);
  }
}

// Same logic as buildHookCommand (for pure function testing)
function buildHookCommand(template: string, vars: HookVars): string {
  validateHookVars(vars);
  return template
    .replace(/\{path\}/g, vars.path)
    .replace(/\{slot\}/g, vars.slot !== undefined ? String(vars.slot) : "");
}

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
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/$(rm -rf /)" })).toThrow("contains shell metacharacters");
  });

  test("rejects path containing backticks", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp/`whoami`" })).toThrow("contains shell metacharacters");
  });

  test("rejects path containing semicolons", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp; rm -rf /" })).toThrow("contains shell metacharacters");
  });

  test("rejects path containing pipes", () => {
    expect(() => buildHookCommand("cd {path}", { path: "/tmp | cat /etc/passwd" })).toThrow(
      "contains shell metacharacters",
    );
  });

  test("allows normal paths (hyphens, slashes, dots, underscores)", () => {
    const result = buildHookCommand("cd {path}", {
      path: "/home/user/my-project_v2/work.tree",
    });
    expect(result).toBe("cd /home/user/my-project_v2/work.tree");
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

  test("falls back to hookTimeout when hook-specific value is not set", () => {
    const config: ProjectConfig = { hookTimeout: 120 };
    expect(resolveHookTimeout("postCreate", config)).toBe(120);
    expect(resolveHookTimeout("preClean", config)).toBe(120);
  });

  test("returns DEFAULT_HOOK_TIMEOUT when nothing is configured", () => {
    const config: ProjectConfig = {};
    expect(resolveHookTimeout("postCreate", config)).toBe(DEFAULT_HOOK_TIMEOUT);
    expect(resolveHookTimeout("preClean", config)).toBe(DEFAULT_HOOK_TIMEOUT);
  });

  test("returns DEFAULT_HOOK_TIMEOUT when config is null", () => {
    expect(resolveHookTimeout("postCreate", null)).toBe(DEFAULT_HOOK_TIMEOUT);
    expect(resolveHookTimeout("preClean", null)).toBe(DEFAULT_HOOK_TIMEOUT);
  });
});

describe("runHook timeout", () => {
  const sleepCmd = "bun -e 'await Bun.sleep(10000)'";

  test("throws timeout error when command exceeds timeout", async () => {
    await expect(runHook(sleepCmd, testCwd, { timeout: 1 })).rejects.toThrow(
      `Hook command timed out after 1s: ${sleepCmd}`,
    );
  });

  test("completes successfully within timeout", async () => {
    await expect(runHook("echo ok", testCwd, { timeout: 10 })).resolves.toBeUndefined();
  });

  test("throws timeout error with onLine mode", async () => {
    const lines: string[] = [];
    await expect(runHook(sleepCmd, testCwd, { timeout: 1, onLine: (line) => lines.push(line) })).rejects.toThrow(
      `Hook command timed out after 1s: ${sleepCmd}`,
    );
  });
});
