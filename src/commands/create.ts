import { randomUUID } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { buildHerdrLabel, buildHookCommand, loadProjectConfig, resolveHookTimeout } from "../core/config.ts";
import { GitError, getErrorMessage, isNodeError, UsageError } from "../core/errors.ts";
import {
  branchExists,
  buildWorktreeCommand,
  createWorktree,
  deleteLocalBranch,
  fetchOrigin,
  getBranchCommitSha,
  getGitContext,
  getWorktreePath,
  listWorktrees,
  removeWorktree,
  restoreLocalBranch,
  verifyBranchRef,
} from "../core/git.ts";
import { completeSession, deleteSession, saveSession } from "../core/session.ts";
import { assignSlot, deleteSlot, readSlot } from "../core/slot.ts";
import { spawnInteractive } from "../core/spawn.ts";
import { buildClaudeCommand } from "../external/claude.ts";
import { ensurePaneBackendAvailable } from "../external/terminal-backend.ts";
import { getSessionForPane, isRunningInsideTmux } from "../external/tmux.ts";
import type {
  ClaudeOptions,
  CreateArgs,
  CreateDeps,
  CreatedPane,
  GitContext,
  LaunchResult,
  ProjectConfig,
  RollbackOptions,
  RunInPaneArgs,
  TerminalBackend,
  WorktreeInfo,
} from "../types/index.ts";
import { icons } from "../ui/icons.ts";
import { printJsonLine } from "../ui/json.ts";
import { logError, logInfo, logWarn } from "../ui/logger.ts";
import { confirm, rejectConfirmNonInteractive } from "../ui/prompt.ts";
import { startSpinner } from "../ui/spinner.ts";
import { executeHookWithSpinner } from "./hooks.ts";
import { performRollback } from "./rollback.ts";

// =============================================================================
// Default dependencies (DI)
// =============================================================================

const defaultDeps: CreateDeps = {
  getGitContext,
  getWorktreePath,
  loadProjectConfig,
  listWorktrees,
  branchExists,
  verifyBranchRef,
  fetchOrigin,
  createWorktree,
  removeWorktree,
  deleteLocalBranch,
  getBranchCommitSha,
  restoreLocalBranch,
  buildHookCommand,
  resolveHookTimeout,
  executeHookWithSpinner,
  assignSlot,
  readSlot,
  deleteSlot,
  saveSession,
  completeSession,
  deleteSession,
  buildClaudeCommand,
  ensurePaneBackend: ensurePaneBackendAvailable,
  confirm,
  startSpinner,
  performRollback,
};

// =============================================================================
// Pure helper functions
// =============================================================================

const MAX_PLAN_FILE_SIZE = 1024 * 1024; // 1MB

export async function readPlanFile(filePath: string): Promise<string> {
  // Check file existence and size before reading
  let fileSize: number;
  try {
    const fileStat = await stat(filePath);
    fileSize = fileStat.size;
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      throw new UsageError(`Plan file not found: ${filePath}`);
    }
    throw new UsageError(`Failed to read plan file ${filePath}: ${getErrorMessage(err)}`);
  }

  if (fileSize > MAX_PLAN_FILE_SIZE) {
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    throw new UsageError(`Plan file is too large (${sizeMB}MB). Maximum allowed size is 1MB: ${filePath}`);
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    throw new UsageError(`Failed to read plan file ${filePath}: ${error.message}`);
  }

  const trimmed = content.trim();

  if (!trimmed) {
    throw new UsageError(`Plan file is empty: ${filePath}`);
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
    return `${icons.warning()} Worktree limit reached (${effective}/${maxWorktrees}). Run \`claude-worktree clean\` to remove unused worktrees.`;
  }
  return null;
}

export function previewHookTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template);
}

export function getSelfCommand(): string {
  return `"${process.argv[0]}" "${resolve(process.argv[1])}"`;
}

/**
 * Build Claude command options from create args and git context.
 */
export function buildClaudeOptions(
  args: Pick<CreateArgs, "prompt" | "danger" | "merge" | "draft" | "pr" | "model">,
  git: GitContext,
  worktreePath: string,
  effectiveBaseBranch: string,
  branchName: string,
  config: ProjectConfig | null,
): ClaudeOptions {
  return {
    prompt: args.prompt,
    dangerouslySkipPermissions: args.danger,
    ...(args.model && { model: args.model }),
    ...(config?.permissionMode && { permissionMode: config.permissionMode }),
    ...(args.merge && {
      mergeInstructions: {
        baseBranch: git.currentBranch,
        worktreePath,
      },
    }),
    ...(args.draft && {
      draftInstructions: {
        baseBranch: effectiveBaseBranch,
        branchName,
      },
    }),
    ...(args.pr && {
      prInstructions: {
        baseBranch: effectiveBaseBranch,
        branchName,
      },
    }),
  };
}

// =============================================================================
// Extracted sub-routines
// =============================================================================

/**
 * What a destructive replacement step already removed, so a later failure can
 * report it precisely and put back what is restorable.
 *
 * The removed worktree's uncommitted contents are gone for good once
 * `git worktree remove --force` has run; only the branch ref can be restored.
 */
type DestroyedState = {
  /** Path of the worktree that was removed. Its uncommitted contents are unrecoverable. */
  removedWorktreePath?: string;
  /** True when the branch was deleted, even if its commit could not be resolved beforehand. */
  branchDeleted?: boolean;
  /** Commit the deleted branch pointed at, when it could be resolved before deletion. */
  deletedBranchSha?: string;
};

/**
 * Handle an existing worktree for the target branch.
 * Prompts user, runs clean hooks, removes worktree/branch.
 * Returns what was destroyed, or null if the user cancelled.
 */
async function handleExistingWorktree(
  existingWorktree: WorktreeInfo,
  config: ProjectConfig | null,
  repoRoot: string,
  branchName: string,
  verbose: boolean,
  deps: CreateDeps,
): Promise<DestroyedState | null> {
  logInfo(`\n${icons.warning()}  Worktree already exists: ${existingWorktree.path}`);

  let confirmed: boolean;
  if (existingWorktree.isDirty) {
    logInfo(`${icons.warning()}  Warning: there are uncommitted changes`);
    confirmed = await deps.confirm("Discard changes and delete the worktree?", { danger: true });
  } else {
    confirmed = await deps.confirm("Delete the existing worktree and start a new session?", { danger: true });
  }

  if (!confirmed) {
    logInfo("Cancelled.");
    return null;
  }

  const existingSlot = await deps.readSlot(existingWorktree.path);

  // preClean hook
  if (config?.preClean) {
    const hookCmd = deps.buildHookCommand(config.preClean, { path: existingWorktree.path, slot: existingSlot });
    const result = await deps.executeHookWithSpinner({
      hookCmd,
      cwd: repoRoot,
      label: "preClean",
      verbose,
      timeout: deps.resolveHookTimeout("preClean", config),
    });
    if (!result.success) {
      logWarn(`  preClean hook failed (continuing): ${result.message}`);
    }
  }

  const destroyed: DestroyedState = {};

  // Delete existing worktree and branch
  logInfo(`${icons.trash()}  Deleting existing worktree...`);
  await deps.removeWorktree(existingWorktree.path, existingWorktree.isDirty);
  destroyed.removedWorktreePath = existingWorktree.path;
  logInfo(`  ${icons.success()} Worktree deleted: ${existingWorktree.path}`);

  // Capture the branch tip before deleting it so a failed `git worktree add`
  // can put the ref back (see runCreate).
  const branchShaBeforeDelete = await deps.getBranchCommitSha(branchName);

  try {
    await deps.deleteLocalBranch(branchName, true);
    destroyed.branchDeleted = true;
    if (branchShaBeforeDelete) {
      destroyed.deletedBranchSha = branchShaBeforeDelete;
    }
    logInfo(`  ${icons.success()} Branch deleted: ${branchName}`);
  } catch (error) {
    // git reports a branch that is already gone as "branch '<name>' not found";
    // that is the only ignorable case — anything else (a locked ref, a branch
    // still checked out elsewhere) is a real failure and must say so.
    const message = getErrorMessage(error);
    if (/\bnot found\b/i.test(message)) {
      logInfo(`  ${icons.warning()}  Branch not found (skipping): ${branchName}`);
    } else {
      logWarn(`  Failed to delete branch ${branchName}: ${message}`);
    }
  }

  // postClean hook
  if (config?.postClean) {
    const hookCmd = deps.buildHookCommand(config.postClean, { path: existingWorktree.path, slot: existingSlot });
    const result = await deps.executeHookWithSpinner({
      hookCmd,
      cwd: repoRoot,
      label: "postClean",
      verbose,
      timeout: deps.resolveHookTimeout("postClean", config),
    });
    if (!result.success) {
      logWarn(`  postClean hook failed (continuing): ${result.message}`);
    }
  }

  // Slot and session caches use separate lock files — safe to delete concurrently.
  await Promise.all([deps.deleteSlot(existingWorktree.path), deps.deleteSession(existingWorktree.path)]);

  logInfo("");
  return destroyed;
}

/**
 * Handle an existing branch (without worktree) for the target branch name.
 * Prompts user and deletes the branch if confirmed.
 * Returns what was destroyed, or null if the user cancelled or deletion failed.
 */
async function handleExistingBranch(branchName: string, deps: CreateDeps): Promise<DestroyedState | null> {
  const branchAlreadyExists = await deps.branchExists(branchName);
  if (!branchAlreadyExists) {
    return {};
  }

  logInfo(`\n${icons.warning()}  Branch already exists: ${branchName}`);

  const confirmed = await deps.confirm("Delete the branch and create a new one?", { danger: true });
  if (!confirmed) {
    logInfo("Cancelled.");
    return null;
  }

  // Capture the branch tip before deleting it so a failed `git worktree add`
  // can put the ref back (see runCreate).
  const branchShaBeforeDelete = await deps.getBranchCommitSha(branchName);

  logInfo(`${icons.trash()}  Deleting existing branch...`);
  try {
    await deps.deleteLocalBranch(branchName, true);
    logInfo(`  ${icons.success()} Branch deleted: ${branchName}`);
  } catch (e) {
    const errorMessage = getErrorMessage(e);
    logInfo(`  ${icons.error()} Failed to delete branch: ${errorMessage}`);
    return null;
  }
  logInfo("");

  const destroyed: DestroyedState = { branchDeleted: true };
  if (branchShaBeforeDelete) {
    destroyed.deletedBranchSha = branchShaBeforeDelete;
  }
  return destroyed;
}

/**
 * Build the error for a `git worktree add` failure that happened after an existing
 * worktree or branch was already replaced. Restores the deleted branch ref when the
 * commit is known; the removed worktree's uncommitted contents cannot be restored, so
 * the message names exactly what was destroyed and what was not created.
 */
async function buildReplacementFailureError(
  cause: unknown,
  branchName: string,
  worktreePath: string,
  destroyed: DestroyedState,
  deps: CreateDeps,
): Promise<Error> {
  const lines = [
    getErrorMessage(cause),
    "",
    `The new worktree was NOT created: ${worktreePath}`,
    "",
    "Already deleted before this failure:",
  ];

  if (destroyed.removedWorktreePath) {
    lines.push(`  - Worktree removed: ${destroyed.removedWorktreePath}`);
    lines.push("    Its uncommitted changes cannot be recovered.");
  }

  if (destroyed.branchDeleted) {
    const sha = destroyed.deletedBranchSha;
    if (!sha) {
      lines.push(`  - Branch deleted: ${branchName}`);
      lines.push("    Its commit could not be resolved beforehand, so the ref cannot be restored.");
    } else {
      try {
        await deps.restoreLocalBranch(branchName, sha);
        lines.push(`  - Branch deleted: ${branchName} — restored to ${sha}`);
      } catch (restoreError) {
        lines.push(`  - Branch deleted: ${branchName} (was at ${sha})`);
        lines.push(`    Restore failed: ${getErrorMessage(restoreError)}`);
        lines.push(`    Restore it manually with: git branch ${branchName} ${sha}`);
      }
    }
  }

  return new GitError(lines.join("\n"));
}

/**
 * Build RollbackOptions from the current context.
 */
function buildRollbackOptions(ctx: {
  worktreePath: string;
  repoRoot: string;
  branchName: string;
  config: ProjectConfig | null;
  slot?: number;
  verbose: boolean;
  deleteSessionData: boolean;
  deps: CreateDeps;
}): RollbackOptions {
  const { worktreePath, config, slot, deps } = ctx;
  return {
    worktreePath: ctx.worktreePath,
    repoRoot: ctx.repoRoot,
    branchName: ctx.branchName,
    preCleanCommand: config?.preClean
      ? deps.buildHookCommand(config.preClean, { path: worktreePath, slot })
      : undefined,
    preCleanTimeout: deps.resolveHookTimeout("preClean", config),
    postCleanCommand: config?.postClean
      ? deps.buildHookCommand(config.postClean, { path: worktreePath, slot })
      : undefined,
    postCleanTimeout: deps.resolveHookTimeout("postClean", config),
    slot,
    verbose: ctx.verbose,
    deleteSessionData: ctx.deleteSessionData,
  };
}

/**
 * Launch Claude Code in a new pane (WezTerm or tmux).
 */
async function launchClaudeInPane(
  options: {
    worktreePath: string;
    repoRoot: string;
    branchName: string;
    baseBranch: string;
    config: ProjectConfig | null;
    claudeOptions: ClaudeOptions;
    backend: TerminalBackend;
    slot?: number;
    verbose: boolean;
    quiet: boolean;
    json: boolean;
  },
  deps: CreateDeps,
): Promise<void> {
  const { worktreePath, repoRoot, branchName, baseBranch, config, claudeOptions, backend, slot, verbose, quiet, json } =
    options;

  const claudeCommand = deps.buildClaudeCommand(claudeOptions);

  const runInPaneArgs: RunInPaneArgs = {
    worktreePath,
    repoRoot,
    branchName,
    claudeCommand,
    postCreateCommand: config?.postCreate
      ? deps.buildHookCommand(config.postCreate, { path: worktreePath, slot })
      : undefined,
    postCreateTimeout: deps.resolveHookTimeout("postCreate", config),
    preCleanCommand: config?.preClean
      ? deps.buildHookCommand(config.preClean, { path: worktreePath, slot })
      : undefined,
    preCleanTimeout: deps.resolveHookTimeout("preClean", config),
    postCleanCommand: config?.postClean
      ? deps.buildHookCommand(config.postClean, { path: worktreePath, slot })
      : undefined,
    postCleanTimeout: deps.resolveHookTimeout("postClean", config),
    slot,
    verbose,
    quiet,
  };

  const payloadPath = join(tmpdir(), `claude-worktree-${randomUUID()}.json`);
  await writeFile(payloadPath, JSON.stringify(runInPaneArgs), { encoding: "utf-8", flag: "wx", mode: 0o600 });

  let paneIdStr: string | undefined;
  let createdPane: CreatedPane | undefined;
  // Tracks whether this process wrote the session entry. Rollback may only delete
  // a session entry this process created — a worktree path can be reused, and
  // deleting an entry written by another process would drop a live session.
  let sessionSaved = false;
  try {
    const label = buildHerdrLabel(config, { repo: basename(repoRoot), branch: branchName });
    createdPane = await backend.createPane({ keepFocus: true, cwd: worktreePath, label });
    paneIdStr = createdPane.paneId;
    logInfo(
      `${icons.window()} Created pane: ${paneIdStr}${createdPane.workspaceId ? ` (workspace ${createdPane.workspaceId})` : ""}`,
    );

    await backend.sendCommand(paneIdStr, `${getSelfCommand()} _run-in-pane "${payloadPath}"`);

    // Save session metadata with backend type
    const paneId = backend.name === "wezterm" ? Number.parseInt(paneIdStr, 10) : paneIdStr;
    await deps.saveSession(worktreePath, {
      paneId,
      backendType: backend.name,
      mode: "pane",
      startedAt: new Date().toISOString(),
      ...(createdPane.workspaceId !== undefined && { workspaceId: createdPane.workspaceId }),
    });
    sessionSaved = true;

    if (json) {
      printJsonLine({
        dryRun: false,
        repoRoot,
        branch: branchName,
        baseBranch,
        worktreePath,
        mode: "pane",
        backend: backend.name,
        paneId,
        workspaceId: createdPane.workspaceId ?? null,
        claudeCommand,
      } satisfies LaunchResult);
    }

    logInfo(`${icons.done()} Worktree created and Claude started in new pane`);

    // Show tmux attach hint when launched from outside tmux
    if (backend.name === "tmux" && !isRunningInsideTmux()) {
      const sessionName = await getSessionForPane(paneIdStr);
      logInfo(`\n  To view the session, run: tmux attach -t ${sessionName}`);
    }
  } catch (error) {
    // Close orphaned pane if it was created before the failure
    if (createdPane) {
      await backend.closePane(createdPane).catch(() => {});
    }
    // Clean up temp file on failure (the pane side handles its own cleanup on success)
    await unlink(payloadPath).catch(() => {});
    await deps.performRollback(
      buildRollbackOptions({
        worktreePath,
        repoRoot,
        branchName,
        config,
        slot,
        verbose,
        deleteSessionData: sessionSaved,
        deps,
      }),
    );
    throw error;
  }
}

/**
 * Launch Claude Code in the current terminal.
 */
async function launchClaudeInTerminal(
  options: {
    worktreePath: string;
    repoRoot: string;
    branchName: string;
    config: ProjectConfig | null;
    claudeOptions: ClaudeOptions;
    slot?: number;
    verbose: boolean;
  },
  deps: CreateDeps,
): Promise<void> {
  const { worktreePath, repoRoot, branchName, config, claudeOptions, slot, verbose } = options;

  // postCreate hook
  if (config?.postCreate) {
    const hookCmd = deps.buildHookCommand(config.postCreate, { path: worktreePath, slot });
    const result = await deps.executeHookWithSpinner({
      hookCmd,
      cwd: repoRoot,
      label: "postCreate",
      verbose,
      timeout: deps.resolveHookTimeout("postCreate", config),
    });
    if (!result.success) {
      logError(`postCreate hook failed: ${result.message}`);
      await deps.performRollback(
        buildRollbackOptions({
          worktreePath,
          repoRoot,
          branchName,
          config,
          slot,
          verbose,
          // No session entry exists yet — saveSession runs after this point.
          deleteSessionData: false,
          deps,
        }),
      );
      return;
    }
  }

  // Launch Claude Code in current terminal
  logInfo(`${icons.done()} Worktree created. Starting Claude Code...`);

  const claudeCommand = deps.buildClaudeCommand(claudeOptions);

  // Save session metadata before launching
  await deps.saveSession(worktreePath, {
    mode: "terminal",
    startedAt: new Date().toISOString(),
  });

  // spawnInteractive handles the first signal by forwarding it to the child process.
  // These handlers catch a subsequent signal to ensure completeSession() is called
  // before the process exits (otherwise the session stays "Running" forever).
  let signalReceived = false;
  let sessionCompleted = false;

  const doCompleteSession = async () => {
    if (sessionCompleted) return;
    sessionCompleted = true;
    // Swallow the error: this runs in a `finally`, where a throw would replace the
    // original spawnInteractive error and hide the real failure.
    await deps.completeSession(worktreePath).catch(() => {});
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
    await spawnInteractive({ command: claudeCommand, cwd: worktreePath });
  } finally {
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    // Always mark session as completed in terminal mode since the process has ended
    await doCompleteSession();
  }
}

// =============================================================================
// Main orchestration
// =============================================================================

export async function runCreate(args: CreateArgs, baseDeps: CreateDeps = defaultDeps): Promise<void> {
  // -json is non-interactive: a confirmation prompt would block automation, so fail instead of asking.
  const deps: CreateDeps = args.json ? { ...baseDeps, confirm: rejectConfirmNonInteractive } : baseDeps;

  const { branchName, planFile, merge, draft, pr, baseBranch, pane } = args;
  let { prompt } = args;

  // Check pane backend availability when -pane is specified
  let backend: TerminalBackend | undefined;
  if (pane) {
    backend = await deps.ensurePaneBackend(`claude-worktree ${branchName} '...'`);
  }

  // Read prompt from plan file
  if (planFile) {
    prompt = await readPlanFile(planFile);
  }

  // Get git info
  const git = await deps.getGitContext();
  const worktreePath = deps.getWorktreePath(git.repoRoot, git.repoName, branchName);
  const effectiveBaseBranch = baseBranch ?? git.currentBranch;

  // Kick off independent local lookups now — they overlap with base-branch
  // verification and the optional -pull fetch below. No-op catches prevent an
  // unhandled rejection if an earlier step throws first; real errors still
  // surface at the awaits below.
  const configPromise = deps.loadProjectConfig(git.repoRoot);
  const worktreesPromise = deps.listWorktrees();
  configPromise.catch(() => {});
  worktreesPromise.catch(() => {});

  // Verify base branch exists when explicitly specified
  if (baseBranch) {
    const exists = await deps.verifyBranchRef(baseBranch);
    if (!exists) {
      throw new GitError(
        `Base branch not found: "${baseBranch}"\n\n` +
          "Check the branch name and try again. To see available branches:\n" +
          "  git branch -a",
      );
    }
  }

  // Fetch and resolve remote base branch when -pull is specified
  let worktreeBaseBranch = effectiveBaseBranch;
  if (args.pull) {
    if (args.dryRun) {
      // In dry-run, assume remote ref would be used (no network call)
      worktreeBaseBranch = `origin/${effectiveBaseBranch}`;
    } else {
      const fetchSpinner = deps.startSpinner("Fetching latest from origin...");
      try {
        await deps.fetchOrigin(effectiveBaseBranch);
        fetchSpinner.stop(`${icons.success()} Fetched latest from origin.`);
      } catch (err) {
        fetchSpinner.fail(`Failed to fetch from origin: ${getErrorMessage(err)}`);
        throw err;
      }
      const remoteRef = `origin/${effectiveBaseBranch}`;
      const remoteExists = await deps.verifyBranchRef(remoteRef);
      if (remoteExists) {
        worktreeBaseBranch = remoteRef;
      } else {
        logWarn(`Remote branch not found: ${remoteRef} (using local branch)`);
      }
    }
  }

  const config = await configPromise;

  // Fetch worktrees once and reuse for both limit check and existing worktree detection
  const { worktrees } = await worktreesPromise;
  const existingWorktree = worktrees.find((w) => w.branch === branchName) ?? null;

  // Detect worktree path collision (e.g., "feature/auth" and "feature-auth" both map to the same path)
  if (!existingWorktree) {
    const collidingWorktree = worktrees.find((w) => w.path === worktreePath);
    if (collidingWorktree) {
      throw new UsageError(
        `Path collision: branch "${branchName}" maps to the same directory as existing worktree for branch "${collidingWorktree.branch}".\n` +
          `  Path: ${worktreePath}\n\n` +
          `Choose a different branch name, or remove the existing worktree:\n` +
          `  claude-worktree clean ${collidingWorktree.branch}`,
      );
    }
  }

  // Check worktree limit
  if (config?.maxWorktrees != null) {
    const nonMainCount = worktrees.filter((w) => !w.isMain).length;
    const limitError = checkWorktreeLimit(config, nonMainCount, existingWorktree !== null);
    if (limitError) {
      throw new UsageError(limitError);
    }
  }

  // Dry-run: preview what would happen and exit
  if (args.dryRun) {
    logInfo("\nDry Run Preview:");
    let step = 1;

    if (args.pull) {
      logInfo(`  ${step++}. Fetch remote:      git fetch origin ${effectiveBaseBranch}`);
    }

    if (existingWorktree) {
      const existingVars = { path: existingWorktree.path, slot: "<existing>" };

      if (config?.preClean) {
        logInfo(`  ${step++}. Pre-clean hook:    ${previewHookTemplate(config.preClean, existingVars)}`);
      }

      logInfo(`  ${step++}. Replace worktree:  ${existingWorktree.path} (delete and recreate)`);

      if (config?.postClean) {
        logInfo(`  ${step++}. Post-clean hook:   ${previewHookTemplate(config.postClean, existingVars)}`);
      }
    }

    logInfo(`  ${step++}. Create worktree:   ${buildWorktreeCommand(branchName, worktreePath, worktreeBaseBranch)}`);

    if (config?.postCreate) {
      logInfo(
        `  ${step++}. Post-create hook:  ${previewHookTemplate(config.postCreate, { path: worktreePath, slot: "<auto>" })}`,
      );
    }

    logInfo(`  ${step++}. Launch mode:       ${backend ? `${backend.name} pane` : "Current terminal"}`);

    const claudeOptions = buildClaudeOptions(
      { ...args, prompt },
      git,
      worktreePath,
      effectiveBaseBranch,
      branchName,
      config,
    );
    const claudeCmd = deps.buildClaudeCommand(claudeOptions);
    const claudeCmdLines = claudeCmd.split("\n");
    const claudeCmdPreview = claudeCmdLines.length > 1 ? `${claudeCmdLines[0]} ...` : claudeCmdLines[0];
    logInfo(`  ${step++}. Claude command:    ${claudeCmdPreview}`);

    if (args.json) {
      printJsonLine({
        dryRun: true,
        repoRoot: git.repoRoot,
        branch: branchName,
        baseBranch: effectiveBaseBranch,
        worktreePath,
        mode: backend ? "pane" : "terminal",
        backend: backend?.name ?? null,
        paneId: null,
        workspaceId: null,
        claudeCommand: claudeCmd,
      } satisfies LaunchResult);
    }

    return;
  }

  // Display info
  logInfo(`${icons.pin()} Current branch: ${git.currentBranch}`);
  if (baseBranch) {
    logInfo(`${icons.tree()} Base branch: ${baseBranch}`);
  }
  logInfo(`${icons.branch()} New branch: ${branchName}`);
  logInfo(`${icons.folder()} Worktree path: ${worktreePath}`);
  if (planFile) {
    logInfo(`${icons.clipboard()} Plan file: ${planFile}`);
  }
  if (merge) {
    logInfo(`${icons.merge()} Auto-merge to: ${git.currentBranch}`);
  }
  if (draft) {
    logInfo(`${icons.memo()} Draft PR to: ${effectiveBaseBranch}`);
  }
  if (pr) {
    logInfo(`${icons.memo()} PR to: ${effectiveBaseBranch}`);
  }
  if (args.pull) {
    logInfo(`${icons.sparkle()} Pull: fetch latest from remote`);
  }

  // Track what the replacement steps below destroy. There is no ordering that creates
  // before destroying: `git worktree add -b <branch>` refuses to run while <branch>
  // still exists, and the replacement worktree normally occupies the exact same path
  // as the one being removed. So instead capture enough state to put the branch ref
  // back and to report precisely what was lost if the create then fails.
  const destroyed: DestroyedState = {};

  // Handle existing worktree
  if (existingWorktree) {
    const outcome = await handleExistingWorktree(
      existingWorktree,
      config,
      git.repoRoot,
      branchName,
      !!args.verbose,
      deps,
    );
    if (!outcome) return;
    Object.assign(destroyed, outcome);
  }

  // Handle existing branch (without worktree)
  if (!existingWorktree) {
    const outcome = await handleExistingBranch(branchName, deps);
    if (!outcome) return;
    Object.assign(destroyed, outcome);
  }

  // Create worktree
  try {
    await deps.createWorktree(branchName, worktreePath, worktreeBaseBranch);
  } catch (error) {
    if (!destroyed.removedWorktreePath && !destroyed.branchDeleted) {
      // Nothing was replaced — the original error already says everything.
      throw error;
    }
    throw await buildReplacementFailureError(error, branchName, worktreePath, destroyed, deps);
  }

  // Register signal handlers for graceful cleanup during creation phase.
  // Removed before launching Claude (spawnInteractive has its own signal forwarding,
  // launchClaudeInPane has its own error handling with rollback).
  const rollbackBase = {
    worktreePath,
    repoRoot: git.repoRoot,
    branchName,
    config,
    verbose: !!args.verbose,
    deleteSessionData: false,
    deps,
  };
  let rollbackCtx = buildRollbackOptions(rollbackBase);

  const createSignalHandler = (exitCode: number) => async () => {
    try {
      await deps.performRollback(rollbackCtx);
    } catch {
      // performRollback handles its own errors, but ensure we still exit
    } finally {
      process.exit(exitCode);
    }
  };

  const handleSigint = createSignalHandler(130); // 128 + SIGINT(2)
  const handleSigterm = createSignalHandler(143); // 128 + SIGTERM(15)

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  let slot: number | undefined;
  let claudeOptions: ClaudeOptions;

  try {
    // Allocate and persist slot if any hook uses {slot}
    if (config) {
      const anyHookUsesSlot = [config.postCreate, config.preClean, config.postClean].some((h) => h?.includes("{slot}"));
      if (anyHookUsesSlot) {
        slot = await deps.assignSlot(worktreePath);
        // Update rollback context with slot info
        rollbackCtx = buildRollbackOptions({ ...rollbackBase, slot });
      }
    }

    // Build Claude options (use local prompt which may be overridden by plan file)
    claudeOptions = buildClaudeOptions({ ...args, prompt }, git, worktreePath, effectiveBaseBranch, branchName, config);
  } catch (error) {
    // Rollback worktree if assignSlot or buildClaudeOptions fails
    await deps.performRollback(rollbackCtx);
    throw error;
  } finally {
    // Remove signal handlers before launching Claude
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
  }

  // Launch Claude in pane or terminal
  if (pane && backend) {
    await launchClaudeInPane(
      {
        worktreePath,
        repoRoot: git.repoRoot,
        branchName,
        baseBranch: effectiveBaseBranch,
        config,
        claudeOptions,
        backend,
        slot,
        verbose: !!args.verbose,
        quiet: !!args.quiet,
        json: !!args.json,
      },
      deps,
    );
  } else {
    await launchClaudeInTerminal(
      { worktreePath, repoRoot: git.repoRoot, branchName, config, claudeOptions, slot, verbose: !!args.verbose },
      deps,
    );
  }
}
