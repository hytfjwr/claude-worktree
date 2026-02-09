import { describe, expect, test } from "vitest";

import type { ProjectConfig } from "../types";
import { checkWorktreeLimit } from "./create";

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
