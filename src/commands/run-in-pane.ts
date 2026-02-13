import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

import { getErrorMessage, isNodeError } from "../core/errors.ts";
import { spawnInteractive } from "../core/spawn.ts";
import type { RunInPaneArgs } from "../types/index.ts";
import { logError } from "../ui/logger.ts";
import { executeHookWithSpinner } from "./hooks.ts";
import { performRollback } from "./rollback.ts";

export async function parseRunInPaneArgs(payloadPath: string): Promise<RunInPaneArgs> {
  // Validate path to prevent deletion of arbitrary files
  const dir = resolve(dirname(payloadPath));
  const name = basename(payloadPath);
  if (dir !== resolve(tmpdir()) || !name.startsWith("claude-worktree-") || !name.endsWith(".json")) {
    throw new Error(`_run-in-pane: invalid payload path: ${payloadPath}`);
  }

  let content: string;
  try {
    content = await readFile(payloadPath, "utf-8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      throw new Error(`_run-in-pane: payload file not found: ${payloadPath}`);
    }
    throw new Error(`_run-in-pane: failed to read payload file ${payloadPath}: ${getErrorMessage(err)}`);
  }

  // Clean up temp file
  await unlink(payloadPath).catch(() => {});

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("_run-in-pane: invalid JSON payload");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("_run-in-pane: payload must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.worktreePath !== "string" || !obj.worktreePath) {
    throw new Error("_run-in-pane: missing required field 'worktreePath'");
  }
  if (typeof obj.repoRoot !== "string" || !obj.repoRoot) {
    throw new Error("_run-in-pane: missing required field 'repoRoot'");
  }
  if (typeof obj.claudeCommand !== "string" || !obj.claudeCommand) {
    throw new Error("_run-in-pane: missing required field 'claudeCommand'");
  }
  if (
    typeof obj.postCreateTimeout !== "number" ||
    !Number.isFinite(obj.postCreateTimeout) ||
    obj.postCreateTimeout < 0
  ) {
    throw new Error("_run-in-pane: field 'postCreateTimeout' must be a finite non-negative number");
  }
  if (typeof obj.preCleanTimeout !== "number" || !Number.isFinite(obj.preCleanTimeout) || obj.preCleanTimeout < 0) {
    throw new Error("_run-in-pane: field 'preCleanTimeout' must be a finite non-negative number");
  }
  if (typeof obj.postCleanTimeout !== "number" || !Number.isFinite(obj.postCleanTimeout) || obj.postCleanTimeout < 0) {
    throw new Error("_run-in-pane: field 'postCleanTimeout' must be a finite non-negative number");
  }
  if (typeof obj.verbose !== "boolean") {
    throw new Error("_run-in-pane: missing required field 'verbose'");
  }

  return {
    worktreePath: obj.worktreePath,
    repoRoot: obj.repoRoot,
    claudeCommand: obj.claudeCommand,
    postCreateCommand: typeof obj.postCreateCommand === "string" ? obj.postCreateCommand : undefined,
    postCreateTimeout: obj.postCreateTimeout,
    preCleanCommand: typeof obj.preCleanCommand === "string" ? obj.preCleanCommand : undefined,
    preCleanTimeout: obj.preCleanTimeout,
    postCleanCommand: typeof obj.postCleanCommand === "string" ? obj.postCleanCommand : undefined,
    postCleanTimeout: obj.postCleanTimeout,
    slot: typeof obj.slot === "number" ? obj.slot : undefined,
    verbose: obj.verbose,
  };
}

export async function executeRunInPane(args: RunInPaneArgs): Promise<void> {
  const { worktreePath, repoRoot, claudeCommand, verbose } = args;

  // Run postCreate hook if configured
  if (args.postCreateCommand) {
    const result = await executeHookWithSpinner({
      hookCmd: args.postCreateCommand,
      cwd: repoRoot,
      label: "postCreate",
      verbose,
      timeout: args.postCreateTimeout,
    });
    if (!result.success) {
      logError(`postCreate hook failed: ${result.message}`);
      await performRollback({
        worktreePath,
        repoRoot,
        preCleanCommand: args.preCleanCommand,
        preCleanTimeout: args.preCleanTimeout,
        postCleanCommand: args.postCleanCommand,
        postCleanTimeout: args.postCleanTimeout,
        slot: args.slot,
        verbose,
        deleteSessionData: true,
      });
      return;
    }
  }

  // Launch Claude Code
  await spawnInteractive({ command: claudeCommand, cwd: worktreePath });
}
