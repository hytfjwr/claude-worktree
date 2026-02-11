import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHookCommand, loadProjectConfig, resolveHookTimeout, runHook } from "../core/config.ts";
import {
  branchExists,
  createWorktree,
  deleteLocalBranch,
  findWorktreeByBranch,
  getGitContext,
  getWorktreePath,
  listWorktrees,
  removeWorktree,
} from "../core/git.ts";
import { completeSession, deleteSession, saveSession } from "../core/session.ts";
import { deleteSlot, findAvailableSlot, readSlot, saveSlot } from "../core/slot.ts";
import { buildClaudeCommand } from "../external/claude.ts";
import { checkWeztermAvailable, createPane, sendCommand } from "../external/wezterm.ts";
import type { CreateArgs, ProjectConfig, RunInPaneArgs } from "../types.ts";
import { confirm } from "../ui/prompt.ts";
import { createTailUpdater, startSpinner } from "../ui/spinner.ts";
import { performRollback } from "./rollback.ts";

export async function readPlanFile(filePath: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error(`Plan file not found: ${filePath}`);
    }
    throw new Error(`Failed to read plan file ${filePath}: ${error.message}`);
  }

  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(`Plan file is empty: ${filePath}`);
  }

  return trimmed;
}

/**
 * Check if the worktree limit has been reached.
 * Returns an error message string if blocked, or null if OK.
 */
export function checkWorktreeLimit(
  config: ProjectConfig | null,
  currentCount: number,
  isReplace: boolean,
): string | null {
  const maxWorktrees = config?.maxWorktrees;
  if (maxWorktrees == null) {
    return null;
  }
  if (!Number.isInteger(maxWorktrees) || maxWorktrees < 0) {
    return `Invalid maxWorktrees value: ${maxWorktrees}. Must be a non-negative integer.`;
  }
  const effective = isReplace ? currentCount - 1 : currentCount;
  if (effective >= maxWorktrees) {
    return `⚠ Worktree limit reached (${effective}/${maxWorktrees}). Run \`claude-worktree clean\` to remove unused worktrees.`;
  }
  return null;
}

export async function runCreate(args: CreateArgs): Promise<void> {
  const { branchName, planFile, danger, merge, draft, baseBranch, pane } = args;
  let { prompt } = args;

  // Check WezTerm availability when -pane is specified
  if (pane) {
    const available = await checkWeztermAvailable();
    if (!available) {
      throw new Error(
        "WezTerm CLI is not installed. The -pane option requires WezTerm.\n" +
          "Install WezTerm: https://wezfurlong.org/wezterm/installation.html\n" +
          "Or run without -pane to use the current terminal.",
      );
    }
  }

  // Read prompt from plan file
  if (planFile) {
    prompt = await readPlanFile(planFile);
  }

  // Get git info
  const git = await getGitContext();
  const worktreePath = getWorktreePath(git.repoRoot, git.repoName, branchName);

  // Use baseBranch if specified, otherwise use current branch
  const effectiveBaseBranch = baseBranch ?? git.currentBranch;

  const config = await loadProjectConfig(git.repoRoot);

  // Check worktree limit
  if (config?.maxWorktrees != null) {
    const worktrees = await listWorktrees();
    const nonMainCount = worktrees.filter((w) => !w.isMain).length;
    const existingWorktree = worktrees.find((w) => w.branch === branchName) ?? null;
    const limitError = checkWorktreeLimit(config, nonMainCount, existingWorktree !== null);
    if (limitError) {
      console.log(limitError);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`📍 Current branch: ${git.currentBranch}`);
  if (baseBranch) {
    console.log(`🌳 Base branch: ${baseBranch}`);
  }
  console.log(`🌿 New branch: ${branchName}`);
  console.log(`📂 Worktree path: ${worktreePath}`);
  if (planFile) {
    console.log(`📋 Plan file: ${planFile}`);
  }
  if (merge) {
    console.log(`🔀 Auto-merge to: ${git.currentBranch}`);
  }
  if (draft) {
    console.log(`📝 Draft PR to: ${effectiveBaseBranch}`);
  }

  // Check for duplicate existing worktree
  const existingWorktree = await findWorktreeByBranch(branchName);

  if (existingWorktree) {
    console.log(`\n⚠️  Worktree already exists: ${existingWorktree.path}`);

    let confirmed: boolean;
    if (existingWorktree.isDirty) {
      console.log("⚠️  Warning: there are uncommitted changes");
      confirmed = await confirm("Discard changes and delete the worktree?");
    } else {
      confirmed = await confirm("Delete the existing worktree and start a new session?");
    }

    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }

    // Read cached slot for existing worktree
    const existingSlot = await readSlot(existingWorktree.path);

    // preClean hook
    if (config?.preClean) {
      const hookCmd = buildHookCommand(config.preClean, { path: existingWorktree.path, slot: existingSlot });
      const spinner = args.verbose
        ? null
        : startSpinner("Running preClean hook...", { timeoutSec: resolveHookTimeout("preClean", config) });
      try {
        await runHook(hookCmd, git.repoRoot, {
          verbose: args.verbose,
          onLine: spinner ? createTailUpdater(spinner) : undefined,
          timeout: resolveHookTimeout("preClean", config),
        });
        spinner?.stop("✓ preClean hook done");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spinner?.fail(`preClean hook failed (continuing): ${message}`);
        console.warn(`  ⚠️  preClean hook failed (continuing): ${message}`);
      }
    }

    // Delete existing worktree and branch
    console.log("🗑️  Deleting existing worktree...");
    await removeWorktree(existingWorktree.path, existingWorktree.isDirty);
    console.log(`  ✓ Worktree deleted: ${existingWorktree.path}`);

    try {
      await deleteLocalBranch(branchName, true);
      console.log(`  ✓ Branch deleted: ${branchName}`);
    } catch {
      // Ignore if branch does not exist
      console.log(`  ⚠️  Branch not found (skipping): ${branchName}`);
    }

    // postClean hook
    if (config?.postClean) {
      const hookCmd = buildHookCommand(config.postClean, { path: existingWorktree.path, slot: existingSlot });
      const spinner = args.verbose
        ? null
        : startSpinner("Running postClean hook...", { timeoutSec: resolveHookTimeout("postClean", config) });
      try {
        await runHook(hookCmd, git.repoRoot, {
          verbose: args.verbose,
          onLine: spinner ? createTailUpdater(spinner) : undefined,
          timeout: resolveHookTimeout("postClean", config),
        });
        spinner?.stop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spinner?.fail(`postClean hook failed (continuing): ${message}`);
        console.warn(`  ⚠️  postClean hook failed (continuing): ${message}`);
      }
    }

    // Delete cached slot and session for existing worktree
    await deleteSlot(existingWorktree.path);
    await deleteSession(existingWorktree.path);

    console.log("");
  }

  // Check if branch exists without a worktree
  if (!existingWorktree) {
    const branchAlreadyExists = await branchExists(branchName);

    if (branchAlreadyExists) {
      console.log(`\n⚠️  Branch already exists: ${branchName}`);

      const confirmed = await confirm("Delete the branch and create a new one?");

      if (!confirmed) {
        console.log("Cancelled.");
        return;
      }

      console.log("🗑️  Deleting existing branch...");
      try {
        await deleteLocalBranch(branchName, true);
        console.log(`  ✓ Branch deleted: ${branchName}`);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.log(`  ❌ Failed to delete branch: ${errorMessage}`);
        return;
      }
      console.log("");
    }
  }

  // Create worktree directly
  await createWorktree(branchName, worktreePath, effectiveBaseBranch);

  // Allocate and persist slot if any hook uses {slot}
  let slot: number | undefined;
  if (config) {
    const anyHookUsesSlot = [config.postCreate, config.preClean, config.postClean].some((h) => h?.includes("{slot}"));
    if (anyHookUsesSlot) {
      slot = await findAvailableSlot();
      await saveSlot(worktreePath, slot);
    }
  }

  // Build claude command options
  const claudeOptions = {
    prompt,
    dangerouslySkipPermissions: danger,
    ...(merge && {
      mergeInstructions: {
        baseBranch: git.currentBranch,
        worktreePath,
      },
    }),
    ...(draft && {
      draftInstructions: {
        baseBranch: effectiveBaseBranch,
        branchName,
      },
    }),
  };

  if (pane) {
    // Pane mode: create pane first, then run postCreate hook + Claude inside the pane
    const claudeCommand = buildClaudeCommand(claudeOptions);

    const runInPaneArgs: RunInPaneArgs = {
      worktreePath,
      repoRoot: git.repoRoot,
      claudeCommand,
      postCreateCommand: config?.postCreate
        ? buildHookCommand(config.postCreate, { path: worktreePath, slot })
        : undefined,
      postCreateTimeout: resolveHookTimeout("postCreate", config),
      preCleanCommand: config?.preClean ? buildHookCommand(config.preClean, { path: worktreePath, slot }) : undefined,
      preCleanTimeout: resolveHookTimeout("preClean", config),
      postCleanCommand: config?.postClean
        ? buildHookCommand(config.postClean, { path: worktreePath, slot })
        : undefined,
      postCleanTimeout: resolveHookTimeout("postClean", config),
      slot,
      verbose: !!args.verbose,
    };

    const payloadPath = join(tmpdir(), `claude-worktree-${randomUUID()}.json`);
    await writeFile(payloadPath, JSON.stringify(runInPaneArgs), { encoding: "utf-8", flag: "wx", mode: 0o600 });

    try {
      const paneIdStr = await createPane({ keepFocus: true });
      const paneId = Number.parseInt(paneIdStr, 10);
      console.log(`🪟 Created pane: ${paneId}`);

      await sendCommand(paneIdStr, `${getSelfCommand()} _run-in-pane "${payloadPath}"`);

      // Save session metadata
      await saveSession(worktreePath, {
        paneId,
        mode: "pane",
        startedAt: new Date().toISOString(),
      });

      console.log("✅ Worktree created and Claude started in new pane");
    } catch (error) {
      // Clean up temp file on failure (the pane side handles its own cleanup on success)
      await unlink(payloadPath).catch(() => {});
      // Full rollback: saveSession hasn't run yet, so deleteSessionData is false
      await performRollback({
        worktreePath,
        repoRoot: git.repoRoot,
        preCleanCommand: config?.preClean ? buildHookCommand(config.preClean, { path: worktreePath, slot }) : undefined,
        preCleanTimeout: resolveHookTimeout("preClean", config),
        postCleanCommand: config?.postClean
          ? buildHookCommand(config.postClean, { path: worktreePath, slot })
          : undefined,
        postCleanTimeout: resolveHookTimeout("postClean", config),
        slot,
        verbose: !!args.verbose,
        deleteSessionData: false,
      });
      throw error;
    }
  } else {
    // Terminal mode: run postCreate hook here, then launch Claude

    // postCreate hook
    if (config?.postCreate) {
      const hookCmd = buildHookCommand(config.postCreate, { path: worktreePath, slot });
      const spinner = args.verbose
        ? null
        : startSpinner("Running postCreate hook...", { timeoutSec: resolveHookTimeout("postCreate", config) });
      try {
        await runHook(hookCmd, git.repoRoot, {
          verbose: args.verbose,
          onLine: spinner ? createTailUpdater(spinner) : undefined,
          timeout: resolveHookTimeout("postCreate", config),
        });
        spinner?.stop("✓ postCreate hook done");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spinner?.fail("postCreate hook failed");
        console.error(`❌ postCreate hook failed: ${message}`);
        await performRollback({
          worktreePath,
          repoRoot: git.repoRoot,
          preCleanCommand: config?.preClean
            ? buildHookCommand(config.preClean, { path: worktreePath, slot })
            : undefined,
          preCleanTimeout: resolveHookTimeout("preClean", config),
          postCleanCommand: config?.postClean
            ? buildHookCommand(config.postClean, { path: worktreePath, slot })
            : undefined,
          postCleanTimeout: resolveHookTimeout("postClean", config),
          slot,
          verbose: !!args.verbose,
          deleteSessionData: false,
        });
        return;
      }
    }

    // Launch Claude Code in current terminal
    console.log("✅ Worktree created. Starting Claude Code...");

    const commands = [`cd "${worktreePath}"`, buildClaudeCommand(claudeOptions)].join(" && ");

    // Save session metadata before launching
    await saveSession(worktreePath, {
      mode: "terminal",
      startedAt: new Date().toISOString(),
    });

    await new Promise<void>((res, rej) => {
      const proc = spawn("sh", ["-c", commands], {
        stdio: ["inherit", "inherit", "inherit"],
      });

      const forwardSignal = (signal: NodeJS.Signals) => {
        try {
          proc.kill(signal);
        } catch {
          // Process may already be dead
        }
      };
      // Use self-removing handlers so that Node's default signal behavior
      // is restored after the first forward (e.g., a second Ctrl+C terminates immediately)
      const onSigint = () => {
        process.removeListener("SIGINT", onSigint);
        forwardSignal("SIGINT");
      };
      const onSigterm = () => {
        process.removeListener("SIGTERM", onSigterm);
        forwardSignal("SIGTERM");
      };
      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);

      const cleanup = () => {
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
      };

      proc.on("error", (err) => {
        cleanup();
        rej(err);
      });
      proc.on("close", () => {
        cleanup();
        res();
      });
    });

    // Mark session as completed after process exits
    await completeSession(worktreePath);
  }
}

export function getSelfCommand(): string {
  return `"${process.argv[0]}" "${resolve(process.argv[1])}"`;
}
