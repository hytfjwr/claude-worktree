import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";

import type { ProjectConfig } from "../types.ts";
import { checkWorktreeLimit, getSelfCommand, readPlanFile } from "./create.ts";

describe("readPlanFile", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "create-test-"));

  test("reads and trims plan file content", async () => {
    const filePath = join(tmpDir, "plan.md");
    writeFileSync(filePath, "  Hello World  \n");
    const result = await readPlanFile(filePath);
    expect(result).toBe("Hello World");
  });

  test("throws when file does not exist", async () => {
    const filePath = join(tmpDir, "nonexistent.md");
    await expect(readPlanFile(filePath)).rejects.toThrow(`Plan file not found: ${filePath}`);
  });

  test("throws when file is empty", async () => {
    const filePath = join(tmpDir, "empty.md");
    writeFileSync(filePath, "   \n  ");
    await expect(readPlanFile(filePath)).rejects.toThrow(`Plan file is empty: ${filePath}`);
  });

  test("throws with access error for permission denied", async () => {
    const filePath = join(tmpDir, "noperm.md");
    writeFileSync(filePath, "content");
    chmodSync(filePath, 0o000);
    await expect(readPlanFile(filePath)).rejects.toThrow(`Failed to read plan file ${filePath}`);
    chmodSync(filePath, 0o644); // restore for cleanup
  });

  test("throws when file exceeds 1MB", async () => {
    const filePath = join(tmpDir, "large.md");
    // Create a file slightly over 1MB
    writeFileSync(filePath, "x".repeat(1024 * 1024 + 1));
    await expect(readPlanFile(filePath)).rejects.toThrow("too large");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("getSelfCommand", () => {
  const origArgv = [...process.argv];

  afterEach(() => {
    process.argv[0] = origArgv[0];
    process.argv[1] = origArgv[1];
  });

  test("returns quoted argv[0] and resolved argv[1]", () => {
    process.argv[0] = "/usr/local/bin/node";
    process.argv[1] = "bin/claude-worktree.ts";
    const result = getSelfCommand();
    expect(result).toBe(`"/usr/local/bin/node" "${resolve("bin/claude-worktree.ts")}"`);
  });

  test("handles paths with spaces", () => {
    process.argv[0] = "/usr/local/bin/my node";
    process.argv[1] = "/path with spaces/script.ts";
    const result = getSelfCommand();
    expect(result).toBe(`"/usr/local/bin/my node" "${resolve("/path with spaces/script.ts")}"`);
  });
});

describe("checkWorktreeLimit", () => {
  test("returns null when config is null", () => {
    expect(checkWorktreeLimit(null, 3, false)).toBeNull();
  });

  test("returns null when maxWorktrees is undefined", () => {
    const config: ProjectConfig = {};
    expect(checkWorktreeLimit(config, 3, false)).toBeNull();
  });

  test("returns null when count is below limit", () => {
    const config: ProjectConfig = { maxWorktrees: 5 };
    expect(checkWorktreeLimit(config, 3, false)).toBeNull();
  });

  test("returns error message when count is at limit", () => {
    const config: ProjectConfig = { maxWorktrees: 5 };
    const result = checkWorktreeLimit(config, 5, false);
    expect(result).toContain("Worktree limit reached (5/5)");
    expect(result).toContain("claude-worktree clean");
  });

  test("returns error message when count exceeds limit", () => {
    const config: ProjectConfig = { maxWorktrees: 3 };
    const result = checkWorktreeLimit(config, 4, false);
    expect(result).toContain("Worktree limit reached (4/3)");
  });

  test("returns null when at limit but replacing existing worktree", () => {
    const config: ProjectConfig = { maxWorktrees: 5 };
    expect(checkWorktreeLimit(config, 5, true)).toBeNull();
  });

  test("returns error when exceeding limit even with replace", () => {
    const config: ProjectConfig = { maxWorktrees: 3 };
    const result = checkWorktreeLimit(config, 5, true);
    expect(result).toContain("Worktree limit reached (4/3)");
  });

  test("maxWorktrees: 0 blocks all worktree creation", () => {
    const config: ProjectConfig = { maxWorktrees: 0 };
    const result = checkWorktreeLimit(config, 0, false);
    expect(result).toContain("Worktree limit reached (0/0)");
  });

  test("returns error for negative maxWorktrees", () => {
    const config: ProjectConfig = { maxWorktrees: -1 };
    const result = checkWorktreeLimit(config, 0, false);
    expect(result).toContain("Invalid maxWorktrees value: -1");
  });

  test("returns error for non-integer maxWorktrees", () => {
    const config: ProjectConfig = { maxWorktrees: 2.5 };
    const result = checkWorktreeLimit(config, 0, false);
    expect(result).toContain("Invalid maxWorktrees value: 2.5");
  });
});
