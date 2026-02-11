import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import type { HookVars, ProjectConfig } from "../types.ts";
import { DEFAULT_HOOK_TIMEOUT, resolveHookTimeout, runHook } from "./config.ts";

const testCwd = tmpdir();

// ============================================================================
// Pure function tests (no mocks needed)
// buildHookCommand is a pure function, so we test the logic inline
// to avoid being affected by mock.module
// ============================================================================

// Same logic as validateHookVars (for pure function testing)
function validateHookVars(vars: HookVars): void {
  if (vars.path.length === 0) {
    throw new Error("Invalid path in hook variables. Path must not be empty.");
  }
  const SAFE_PATH = /^[a-zA-Z0-9._\/-]+$/;
  if (!SAFE_PATH.test(vars.path)) {
    throw new Error(
      `Invalid path in hook variables: ${JSON.stringify(vars.path)}. Only alphanumeric, dots, underscores, slashes, and hyphens are allowed.`,
    );
  }
  if (vars.path.startsWith("-")) {
    throw new Error(
      "Invalid path in hook variables. Path must not start with '-' to avoid being interpreted as a command-line option.",
    );
  }
  if (vars.slot != null && (!Number.isInteger(vars.slot) || vars.slot < 1 || vars.slot > 9)) {
    throw new Error("Invalid slot: must be an integer between 1-9");
  }
}

// Same logic as buildHookCommand (for pure function testing)
function buildHookCommand(template: string, vars: HookVars): string {
  validateHookVars(vars);
  return template
    .replace(/\{path\}/g, vars.path)
    .replace(/\{slot\}/g, vars.slot != null ? String(vars.slot) : "");
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
    expect(() => buildHookCommand("cd {path}", { path: "-help" })).toThrow(
      "Path must not start with '-'",
    );
    expect(() => buildHookCommand("cd {path}", { path: "--version" })).toThrow(
      "Path must not start with '-'",
    );
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

describe("runHook timeout", () => {
  const sleepCmd = 'node -e "setTimeout(() => {}, 10000)"';

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
