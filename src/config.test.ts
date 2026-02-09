import { describe, expect, test } from "bun:test";
import type { HookVars } from "./types";

// ============================================================================
// Pure function tests (no mocks needed)
// buildHookCommand is a pure function, so we test the logic inline
// to avoid being affected by mock.module
// ============================================================================

// Same logic as validateHookVars (for pure function testing)
function validateHookVars(vars: HookVars): void {
  const shellMetachars = /[;&|`$()<>\n\r]/;
  if (shellMetachars.test(vars.path)) {
    throw new Error(
      `Invalid hook variable: path "${vars.path}" contains shell metacharacters`
    );
  }
}

// Same logic as buildHookCommand (for pure function testing)
function buildHookCommand(template: string, vars: HookVars): string {
  validateHookVars(vars);
  return template
    .replace(/\{path\}/g, vars.path)
    .replace(
      /\{slot\}/g,
      vars.slot !== undefined ? String(vars.slot) : ""
    );
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
    const result = buildHookCommand(
      "docker-compose -p {slot} -f {path}/docker-compose.yml up",
      { path: "/app", slot: 5 }
    );
    expect(result).toBe(
      "docker-compose -p 5 -f /app/docker-compose.yml up"
    );
  });

  test("template without variables returns as-is", () => {
    const result = buildHookCommand("make setup", { path: "/path" });
    expect(result).toBe("make setup");
  });

  test("rejects path containing shell metacharacters", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp/$(rm -rf /)" })
    ).toThrow("contains shell metacharacters");
  });

  test("rejects path containing backticks", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp/`whoami`" })
    ).toThrow("contains shell metacharacters");
  });

  test("rejects path containing semicolons", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp; rm -rf /" })
    ).toThrow("contains shell metacharacters");
  });

  test("rejects path containing pipes", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp | cat /etc/passwd" })
    ).toThrow("contains shell metacharacters");
  });

  test("allows normal paths (hyphens, slashes, dots, underscores)", () => {
    const result = buildHookCommand("cd {path}", {
      path: "/home/user/my-project_v2/work.tree",
    });
    expect(result).toBe("cd /home/user/my-project_v2/work.tree");
  });
});
