import { access } from "node:fs/promises";

import { GitError } from "../core/errors.ts";
import { getGitContext, listWorktrees } from "../core/git.ts";
import { completeSession, saveSession } from "../core/session.ts";
import { spawnInteractive } from "../core/spawn.ts";
import { buildResumeCommand } from "../external/claude.ts";
import { checkWeztermAvailable, createPane, ensureWeztermAvailable, sendCommand } from "../external/wezterm.ts";
import type { ResumeArgs, ResumeDeps, WorktreeInfo } from "../types/index.ts";
import { icons } from "../ui/icons.ts";
import { logDebug, logInfo } from "../ui/logger.ts";
import { selectWorktree } from "../ui/prompt.ts";

// =============================================================================
// Default dependencies (DI)
// =============================================================================

const defaultDeps: ResumeDeps = {
  checkWeztermAvailable,
  getGitContext,
  listWorktrees,
  saveSession,
  completeSession,
  buildResumeCommand,
  createPane,
  sendCommand,
  selectWorktree,
};

// =============================================================================
// Sub-routines
// =============================================================================

/**
 * Launch Claude Code --continue in a new WezTerm pane.
 */
async function launchResumeInPane(worktree: WorktreeInfo, claudeCommand: string, deps: ResumeDeps): Promise<void> {
  const paneIdStr = await deps.createPane({ keepFocus: true });
  const paneId = Number.parseInt(paneIdStr, 10);
  logInfo(`${icons.window()} Created pane: ${paneId}`);

  await deps.sendCommand(paneIdStr, `cd "${worktree.path}" && ${claudeCommand}`);

  await deps.saveSession(worktree.path, {
    paneId,
    mode: "pane",
    startedAt: new Date().toISOString(),
  });

  logInfo(`${icons.done()} Claude resumed in new pane`);
}

/**
 * Launch Claude Code --continue in the current terminal.
 */
async function launchResumeInTerminal(worktree: WorktreeInfo, claudeCommand: string, deps: ResumeDeps): Promise<void> {
  await deps.saveSession(worktree.path, {
    mode: "terminal",
    startedAt: new Date().toISOString(),
  });

  await spawnInteractive({ command: claudeCommand, cwd: worktree.path });

  // Always mark session as completed in terminal mode since the process has ended
  await deps.completeSession(worktree.path);
}

// =============================================================================
// Validation helpers
// =============================================================================

async function resolveTargetWorktree(
  branchName: string | undefined,
  worktrees: WorktreeInfo[],
  deps: ResumeDeps,
): Promise<WorktreeInfo | null> {
  if (branchName) {
    const target = worktrees.find((w) => w.branch === branchName) ?? null;
    if (!target) {
      const available = worktrees.map((w) => `  ${w.branch ?? "(detached)"}  (${w.path})`).join("\n");
      throw new GitError(`Worktree not found for branch: ${branchName}\n\nAvailable worktrees:\n${available}`);
    }
    return target;
  }

  return deps.selectWorktree(worktrees);
}

// =============================================================================
// Main orchestration
// =============================================================================

export async function runResume(args: ResumeArgs, deps: ResumeDeps = defaultDeps): Promise<void> {
  const { branchName, prompt, pane, verbose } = args;

  if (pane) {
    await ensureWeztermAvailable(deps.checkWeztermAvailable, "claude-worktree resume <branch-name>");
  }

  // Get worktree list
  await deps.getGitContext();
  const { worktrees } = await deps.listWorktrees();
  const nonMainWorktrees = worktrees.filter((w) => !w.isMain);

  if (nonMainWorktrees.length === 0) {
    throw new GitError(
      "No worktrees found to resume.\n\n" + "Create a worktree first:\n" + "  claude-worktree <branch-name> <prompt>",
    );
  }

  // Resolve target worktree
  const target = await resolveTargetWorktree(branchName, nonMainWorktrees, deps);
  if (!target) {
    logInfo("Cancelled.");
    return;
  }

  // Verify worktree directory exists
  try {
    await access(target.path);
  } catch {
    throw new GitError(`Worktree directory does not exist: ${target.path}`);
  }

  // Display info
  logInfo(`${icons.branch()} Branch: ${target.branch}`);
  logInfo(`${icons.folder()} Worktree: ${target.path}`);
  if (prompt) {
    logInfo(`${icons.clipboard()} Prompt: ${prompt}`);
  }

  // Build claude command
  const claudeCommand = deps.buildResumeCommand({
    prompt,
    dangerouslySkipPermissions: args.danger,
  });

  if (verbose) {
    logDebug(`Command: ${claudeCommand}`);
  }

  // Launch
  if (pane) {
    await launchResumeInPane(target, claudeCommand, deps);
  } else {
    await launchResumeInTerminal(target, claudeCommand, deps);
  }
}
