import { access } from "node:fs/promises";

import { GitError, getErrorMessage } from "../core/errors.ts";
import { getGitContext, listWorktrees } from "../core/git.ts";
import { completeSession, determineSessionStatus, readSession, saveSession } from "../core/session.ts";
import { spawnInteractive } from "../core/spawn.ts";
import { findClosestMatch } from "../core/suggest.ts";
import { buildResumeCommand } from "../external/claude.ts";
import { ensurePaneBackendAvailable } from "../external/terminal-backend.ts";
import { getSessionForPane, isRunningInsideTmux, listTmuxPanes } from "../external/tmux.ts";
import { listWeztermPanes } from "../external/wezterm.ts";
import type { ResumeArgs, ResumeDeps, TerminalBackend, WorktreeInfo } from "../types/index.ts";
import { icons } from "../ui/icons.ts";
import { logDebug, logInfo, logWarn } from "../ui/logger.ts";
import { confirm, selectWorktree } from "../ui/prompt.ts";

// =============================================================================
// Default dependencies (DI)
// =============================================================================

const defaultDeps: ResumeDeps = {
  getGitContext,
  listWorktrees,
  saveSession,
  completeSession,
  readSession,
  determineSessionStatus,
  listWeztermPanes,
  listTmuxPanes,
  confirm,
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
  let paneIdStr: string | undefined;
  try {
    paneIdStr = await backend.createPane({ keepFocus: true });
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
  } catch (error) {
    // Close orphaned pane if it was created before the failure
    if (paneIdStr) {
      await backend.closePane(paneIdStr).catch(() => {});
    }
    throw error;
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
  let sessionCompleted = false;

  const doCompleteSession = async () => {
    if (sessionCompleted) return;
    sessionCompleted = true;
    await deps.completeSession(worktree.path).catch(() => {});
  };

  const createSignalHandler = (exitCode: number) => () => {
    if (!signalReceived) {
      // First signal: let spawnInteractive forward it to the child process
      signalReceived = true;
      return;
    }
    // Subsequent signal: clean up session and exit
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    doCompleteSession().finally(() => process.exit(exitCode));
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
    // Always mark session as completed in terminal mode since the process has ended
    await doCompleteSession();
  }
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
      const branches = worktrees.map((w) => w.branch).filter((b): b is string => b !== null);
      const suggestion = findClosestMatch(branchName, branches);
      const hint = suggestion ? `\n\nDid you mean "${suggestion}"?` : "";
      throw new GitError(`Worktree not found for branch: ${branchName}${hint}\n\nAvailable worktrees:\n${available}`);
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

  // Get worktree list. Both calls are independent; when both fail (e.g. not a
  // git repo), prefer getGitContext's friendlier error message.
  const [ctxResult, listResult] = await Promise.allSettled([deps.getGitContext(), deps.listWorktrees()]);
  if (ctxResult.status === "rejected") {
    throw ctxResult.reason;
  }
  if (listResult.status === "rejected") {
    throw listResult.reason;
  }
  const { worktrees } = listResult.value;
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

  // Check for existing active session
  const existingSession = await deps.readSession(target.path);
  if (existingSession) {
    // Only query the backend(s) needed for this session's mode
    let weztermPanes: Awaited<ReturnType<typeof deps.listWeztermPanes>> = null;
    let tmuxPanes: Awaited<ReturnType<typeof deps.listTmuxPanes>> = null;

    // Pane listing failures must not silently disable the duplicate-session
    // guard, so the reason is kept and reported instead of being dropped.
    const paneListErrors: string[] = [];
    const listPanes = async <T>(label: string, list: () => Promise<T>): Promise<T | null> => {
      try {
        return await list();
      } catch (error) {
        paneListErrors.push(`${label}: ${getErrorMessage(error)}`);
        return null;
      }
    };

    if (existingSession.mode === "pane") {
      const bt = existingSession.backendType;
      if (bt === "wezterm") {
        weztermPanes = await listPanes("wezterm", deps.listWeztermPanes);
      } else if (bt === "tmux") {
        tmuxPanes = await listPanes("tmux", deps.listTmuxPanes);
      } else {
        // Backward compat: backendType missing, query both
        [weztermPanes, tmuxPanes] = await Promise.all([
          listPanes("wezterm", deps.listWeztermPanes),
          listPanes("tmux", deps.listTmuxPanes),
        ]);
      }
    }

    const allPanes = { wezterm: weztermPanes, tmux: tmuxPanes };
    const state = deps.determineSessionStatus(existingSession, allPanes);

    if (state.status === "running" || state.status === "unknown") {
      if (state.status === "running") {
        logWarn("An active Claude session is already running on this worktree.");
        logWarn("Resuming will overwrite the existing session metadata and may cause conflicts.");
      } else {
        // Fail safe: without a pane list an active session cannot be ruled out,
        // so ask instead of silently launching a second one.
        logWarn("Could not determine whether a Claude session is still running on this worktree.");
        for (const reason of paneListErrors) {
          logWarn(`  ${reason}`);
        }
        logWarn("Resuming may overwrite an active session's metadata and cause conflicts.");
      }
      const confirmed = await deps.confirm("Continue anyway?");
      if (!confirmed) {
        logInfo("Cancelled.");
        return;
      }
    }
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
    model: args.model,
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
