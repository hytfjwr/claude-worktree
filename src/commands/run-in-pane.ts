import { spawn } from "node:child_process";

import { runHook } from "../core/config.ts";
import { removeWorktree } from "../core/git.ts";
import { deleteSession } from "../core/session.ts";
import { deleteSlot } from "../core/slot.ts";
import type { RunInPaneArgs } from "../types.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";

export function parseRunInPaneArgs(args: string[]): RunInPaneArgs {
  if (args.length !== 1) {
    throw new Error("_run-in-pane requires exactly one base64-encoded argument");
  }

  // Buffer.from with "base64" never throws — invalid input silently decodes to garbage,
  // which will then fail JSON.parse below.
  const decoded = Buffer.from(args[0], "base64").toString("utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
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
    const spinner = verbose ? null : startSpinner("Running postCreate hook...", { timeoutSec: args.postCreateTimeout });
    try {
      await runHook(args.postCreateCommand, repoRoot, {
        verbose,
        onLine: spinner ? createTailUpdater(spinner) : undefined,
        timeout: args.postCreateTimeout,
      });
      spinner?.stop("✓ postCreate hook done");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner?.fail("postCreate hook failed");
      console.error(`❌ postCreate hook failed: ${message}`);
      console.log("🗑️  Rolling back...");

      // preClean hook for rollback
      if (args.preCleanCommand) {
        try {
          await runHook(args.preCleanCommand, repoRoot, {
            verbose,
            timeout: args.preCleanTimeout,
          });
        } catch {
          console.warn("  ⚠️  preClean hook failed during rollback");
        }
      }

      // Remove worktree
      try {
        await removeWorktree(worktreePath);
      } catch {
        console.warn("  ⚠️  Failed to rollback worktree");
      }

      // postClean hook after rollback
      if (args.postCleanCommand) {
        const rollbackSpinner = verbose
          ? null
          : startSpinner("Running postClean hook (rollback)...", { timeoutSec: args.postCleanTimeout });
        try {
          await runHook(args.postCleanCommand, repoRoot, {
            verbose,
            onLine: rollbackSpinner ? createTailUpdater(rollbackSpinner) : undefined,
            timeout: args.postCleanTimeout,
          });
          rollbackSpinner?.stop();
        } catch (error) {
          const postCleanMessage = error instanceof Error ? error.message : String(error);
          rollbackSpinner?.fail(`postClean hook failed during rollback: ${postCleanMessage}`);
          console.warn(`  ⚠️  postClean hook failed during rollback: ${postCleanMessage}`);
        }
      }

      // Delete cached slot and session on rollback
      if (args.slot != null) {
        await deleteSlot(worktreePath);
      }
      await deleteSession(worktreePath);

      return;
    }
  }

  // Launch Claude Code
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("sh", ["-c", claudeCommand], {
      stdio: ["inherit", "inherit", "inherit"],
      cwd: worktreePath,
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude command exited with code ${code ?? 1}`));
      }
    });
  });
}
