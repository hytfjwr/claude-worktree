import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { RunInPaneArgs } from "../types/index.ts";
import { parseRunInPaneArgs } from "./run-in-pane.ts";

async function writePayload(obj: unknown): Promise<string> {
  const path = join(tmpdir(), `claude-worktree-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, JSON.stringify(obj), "utf-8");
  return path;
}

const validArgs: RunInPaneArgs = {
  worktreePath: "/tmp/worktree",
  repoRoot: "/tmp/repo",
  claudeCommand: 'claude --prompt "hello"',
  postCreateCommand: "docker-compose up -d",
  postCreateTimeout: 300,
  preCleanCommand: "docker-compose down",
  preCleanTimeout: 120,
  postCleanCommand: "docker volume rm data",
  postCleanTimeout: 60,
  slot: 1,
  verbose: false,
};

describe("parseRunInPaneArgs", () => {
  test("valid payload - decodes all fields and deletes temp file", async () => {
    const path = await writePayload(validArgs);
    const result = await parseRunInPaneArgs(path);
    expect(result).toEqual(validArgs);
    expect(existsSync(path)).toBe(false);
  });

  test("valid payload - optional fields omitted", async () => {
    const minimal = {
      worktreePath: "/tmp/worktree",
      repoRoot: "/tmp/repo",
      claudeCommand: "claude",
      postCreateTimeout: 600,
      preCleanTimeout: 600,
      postCleanTimeout: 600,
      verbose: true,
    };
    const path = await writePayload(minimal);
    const result = await parseRunInPaneArgs(path);
    expect(result).toEqual({
      ...minimal,
      postCreateCommand: undefined,
      preCleanCommand: undefined,
      postCleanCommand: undefined,
      slot: undefined,
    });
  });

  test("error: invalid payload path - outside tmpdir", async () => {
    await expect(parseRunInPaneArgs("/some/random/claude-worktree-foo.json")).rejects.toThrow("invalid payload path");
  });

  test("error: invalid payload path - wrong prefix", async () => {
    const path = join(tmpdir(), "not-a-payload.json");
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("invalid payload path");
  });

  test("error: file not found", async () => {
    const path = join(tmpdir(), `claude-worktree-nonexistent-${Date.now()}.json`);
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("payload file not found");
  });

  test("error: invalid JSON - deletes temp file", async () => {
    const path = join(tmpdir(), `claude-worktree-bad-${Date.now()}.json`);
    await writeFile(path, "not json at all{", "utf-8");
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("invalid JSON payload");
    expect(existsSync(path)).toBe(false);
  });

  test("error: missing worktreePath", async () => {
    const { worktreePath: _, ...rest } = validArgs;
    const path = await writePayload(rest);
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("missing required field 'worktreePath'");
  });

  test("error: missing repoRoot", async () => {
    const { repoRoot: _, ...rest } = validArgs;
    const path = await writePayload(rest);
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("missing required field 'repoRoot'");
  });

  test("error: missing claudeCommand", async () => {
    const { claudeCommand: _, ...rest } = validArgs;
    const path = await writePayload(rest);
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("missing required field 'claudeCommand'");
  });

  test("error: missing postCreateTimeout", async () => {
    const { postCreateTimeout: _, ...rest } = validArgs;
    const path = await writePayload(rest);
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("'postCreateTimeout' must be a finite non-negative number");
  });

  test("error: negative timeout", async () => {
    const path = await writePayload({ ...validArgs, postCreateTimeout: -1 });
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("'postCreateTimeout' must be a finite non-negative number");
  });

  test("error: NaN timeout", async () => {
    // NaN is serialized as null in JSON, so it becomes a missing field
    const path = await writePayload({ ...validArgs, preCleanTimeout: Number.NaN });
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("'preCleanTimeout' must be a finite non-negative number");
  });

  test("error: Infinity timeout", async () => {
    // Infinity is serialized as null in JSON, so it becomes a missing field
    const path = await writePayload({ ...validArgs, postCleanTimeout: Number.POSITIVE_INFINITY });
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("'postCleanTimeout' must be a finite non-negative number");
  });

  test("error: missing verbose", async () => {
    const { verbose: _, ...rest } = validArgs;
    const path = await writePayload(rest);
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("missing required field 'verbose'");
  });

  test.each([null, [], "string", 0, true])("error: non-object payload (%j)", async (value) => {
    const path = await writePayload(value);
    await expect(parseRunInPaneArgs(path)).rejects.toThrow("payload must be a JSON object");
  });
});

// ============================================================================
// executeRunInPane
// ============================================================================

vi.mock("./hooks.ts", () => ({
  executeHookWithSpinner: vi.fn(),
}));

vi.mock("../core/spawn.ts", () => ({
  spawnInteractive: vi.fn(),
}));

vi.mock("./rollback.ts", () => ({
  performRollback: vi.fn(),
}));

vi.mock("../ui/logger.ts", () => ({
  logError: vi.fn(),
}));

const { executeRunInPane } = await import("./run-in-pane.ts");
const { executeHookWithSpinner } = await import("./hooks.ts");
const { spawnInteractive } = await import("../core/spawn.ts");
const { performRollback } = await import("./rollback.ts");

const mockExecuteHook = vi.mocked(executeHookWithSpinner);
const mockSpawnInteractive = vi.mocked(spawnInteractive);
const mockPerformRollback = vi.mocked(performRollback);

describe("executeRunInPane", () => {
  test("runs postCreate hook then launches Claude Code", async () => {
    mockExecuteHook.mockResolvedValue({ success: true });
    mockSpawnInteractive.mockResolvedValue(0);

    await executeRunInPane({ ...validArgs, postCreateCommand: "docker up" });

    expect(mockExecuteHook).toHaveBeenCalledWith({
      hookCmd: "docker up",
      cwd: validArgs.repoRoot,
      label: "postCreate",
      verbose: false,
      timeout: validArgs.postCreateTimeout,
    });
    expect(mockSpawnInteractive).toHaveBeenCalledWith({
      command: validArgs.claudeCommand,
      cwd: validArgs.worktreePath,
    });
  });

  test("rolls back and does not launch Claude when postCreate hook fails", async () => {
    mockExecuteHook.mockResolvedValue({ success: false, message: "timeout" });
    mockPerformRollback.mockResolvedValue(undefined);

    await executeRunInPane({ ...validArgs, postCreateCommand: "docker up" });

    expect(mockPerformRollback).toHaveBeenCalledWith({
      worktreePath: validArgs.worktreePath,
      repoRoot: validArgs.repoRoot,
      preCleanCommand: validArgs.preCleanCommand,
      preCleanTimeout: validArgs.preCleanTimeout,
      postCleanCommand: validArgs.postCleanCommand,
      postCleanTimeout: validArgs.postCleanTimeout,
      slot: validArgs.slot,
      verbose: false,
      deleteSessionData: true,
    });
    expect(mockSpawnInteractive).not.toHaveBeenCalled();
  });

  test("skips hook and launches Claude directly when no postCreateCommand", async () => {
    mockSpawnInteractive.mockResolvedValue(0);

    const argsWithoutHook = { ...validArgs, postCreateCommand: undefined };
    await executeRunInPane(argsWithoutHook);

    expect(mockExecuteHook).not.toHaveBeenCalled();
    expect(mockSpawnInteractive).toHaveBeenCalledWith({
      command: validArgs.claudeCommand,
      cwd: validArgs.worktreePath,
    });
  });
});
