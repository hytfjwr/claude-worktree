import { access } from "node:fs/promises";

import { GitError } from "../core/errors.ts";
import { getGitContext, listWorktrees } from "../core/git.ts";
import { completeSession, saveSession } from "../core/session.ts";
import { spawnInteractive } from "../core/spawn.ts";
import { buildResumeCommand } from "../external/claude.ts";
import { ensurePaneBackendAvailable } from "../external/terminal-backend.ts";
import { getSessionForPane, isRunningInsideTmux } from "../external/tmux.ts";
import type { ResumeArgs, ResumeDeps, TerminalBackend, WorktreeInfo } from "../types/index.ts";
import { icons } from "../ui/icons.ts";
import { logDebug, logInfo } from "../ui/logger.ts";
import { selectWorktree } from "../ui/prompt.ts";

// =============================================================================
// Default dependencies (DI)
// =============================================================================

const defaultDeps: ResumeDeps = {
  getGitContext,
  listWorktrees,
  saveSession,
  completeSession,
  buildResumeCommand,
  ensurePaneBackend: ensurePaneBackendAvailable,
  selectWorktree,
};

// =============================================================================
// Sub-routines
// =============================================================================

/**
 * Launch Claude Code --continue in a new pane (WezTerm or tmux).
 */
async function launchResumeInPane(
  worktree: WorktreeInfo,
  claudeCommand: string,
  backend: TerminalBackend,
  deps: ResumeDeps,
): Promise<void> {
  const paneIdStr = await backend.createPane({ keepFocus: true });
  logInfo(`${icons.window()} Created pane: ${paneIdStr}`);

  await backend.sendCommand(paneIdStr, `cd "${worktree.path}" && ${claudeCommand}`);

  const paneId = backend.name === "wezterm" ? Number.parseInt(paneIdStr, 10) : paneIdStr;
  await deps.saveSession(worktree.path, {
    paneId,
    backendType: backend.name,
    mode: "pane",
    startedAt: new Date().toISOString(),
  });

  logInfo(`${icons.done()} Claude resumed in new pane`);

  // Show tmux attach hint when launched from outside tmux
  if (backend.name === "tmux" && !isRunningInsideTmux()) {
    const sessionName = await getSessionForPane(paneIdStr);
    logInfo(`\n  To view the session, run: tmux attach -t ${sessionName}`);
  }
}

/**
 * Launch Claude Code --continue in the current terminal.
 */
async function launchResumeInTerminal(worktree: WorktreeInfo, claudeCommand: string, deps: ResumeDeps): Promise<void> {
  await deps.saveSession(worktree.path, {
    mode: "terminal",
    startedAt: new Date().toISOString(),
  });

  // Register signal handlers for graceful session cleanup on interruption.
  // spawnInteractive handles the first signal by forwarding it to the child process.
  // These handlers catch a subsequent signal to ensure completeSession() is called
  // before the process exits (otherwise the session stays "Running" forever).
  let signalReceived = false;

  const createSignalHandler = (exitCode: number) => () => {
    if (!signalReceived) {
      // First signal: let spawnInteractive forward it to the child process
      signalReceived = true;
      return;
    }
    // Subsequent signal: clean up session and exit
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    deps
      .completeSession(worktree.path)
      .catch(() => {})
      .finally(() => process.exit(exitCode));
  };

  const handleSigint = createSignalHandler(130); // 128 + SIGINT(2)
  const handleSigterm = createSignalHandler(143); // 128 + SIGTERM(15)

  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  try {
    await spawnInteractive({ command: claudeCommand, cwd: worktree.path });
  } finally {
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
  }

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

  let backend: TerminalBackend | undefined;
  if (pane) {
    backend = await deps.ensurePaneBackend("claude-worktree resume <branch-name>");
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
  if (pane && backend) {
    await launchResumeInPane(target, claudeCommand, backend, deps);
  } else {
    await launchResumeInTerminal(target, claudeCommand, deps);
  }
}
