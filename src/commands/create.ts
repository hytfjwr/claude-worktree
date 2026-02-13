import { randomUUID } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHookCommand, loadProjectConfig, resolveHookTimeout } from "../core/config.ts";
import { getErrorMessage, isNodeError } from "../core/errors.ts";
import {
  branchExists,
  buildWorktreeCommand,
  createWorktree,
  deleteLocalBranch,
  fetchOrigin,
  getGitContext,
  getWorktreePath,
  listWorktrees,
  removeWorktree,
  verifyBranchRef,
} from "../core/git.ts";
import { completeSession, deleteSession, saveSession } from "../core/session.ts";
import { deleteSlot, findAvailableSlot, readSlot, saveSlot } from "../core/slot.ts";
import { spawnInteractive } from "../core/spawn.ts";
import { buildClaudeCommand } from "../external/claude.ts";
import { checkWeztermAvailable, createPane, sendCommand } from "../external/wezterm.ts";
import type {
  ClaudeOptions,
  CreateArgs,
  CreateDeps,
  GitContext,
  ProjectConfig,
  RollbackOptions,
  RunInPaneArgs,
  WorktreeInfo,
} from "../types.ts";
import { icons } from "../ui/icons.ts";
import { logInfo, logWarn } from "../ui/logger.ts";
import { confirm } from "../ui/prompt.ts";
import { executeHookWithSpinner } from "./hooks.ts";
import { performRollback } from "./rollback.ts";

// =============================================================================
// Default dependencies (DI)
// =============================================================================

const defaultDeps: CreateDeps = {
  checkWeztermAvailable,
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
  buildHookCommand,
  resolveHookTimeout,
  executeHookWithSpinner,
  findAvailableSlot,
  saveSlot,
  readSlot,
  deleteSlot,
  saveSession,
  completeSession,
  deleteSession,
  buildClaudeCommand,
  createPane,
  sendCommand,
  confirm,
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
      throw new Error(`Plan file not found: ${filePath}`);
    }
    throw new Error(`Failed to read plan file ${filePath}: ${getErrorMessage(err)}`);
  }

  if (fileSize > MAX_PLAN_FILE_SIZE) {
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    throw new Error(`Plan file is too large (${sizeMB}MB). Maximum allowed size is 1MB: ${filePath}`);
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
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
    return `${icons.warning()} Worktree limit reached (${effective}/${maxWorktrees}). Run \`claude-worktree clean\` to remove unused worktrees.`;
  }
  return null;
}

export function getSelfCommand(): string {
  return `"${process.argv[0]}" "${resolve(process.argv[1])}"`;
}

/**
 * Build Claude command options from create args and git context.
 */
export function buildClaudeOptions(
  args: Pick<CreateArgs, "prompt" | "danger" | "merge" | "draft">,
  git: GitContext,
  worktreePath: string,
  effectiveBaseBranch: string,
  branchName: string,
): ClaudeOptions {
  return {
    prompt: args.prompt,
    dangerouslySkipPermissions: args.danger,
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
  };
}

// =============================================================================
// Extracted sub-routines
// =============================================================================

/**
 * Handle an existing worktree for the target branch.
 * Prompts user, runs clean hooks, removes worktree/branch.
 * Returns true if creation should continue, false if cancelled.
 */
async function handleExistingWorktree(
  existingWorktree: WorktreeInfo,
  config: ProjectConfig | null,
  repoRoot: string,
  branchName: string,
  verbose: boolean,
  deps: CreateDeps,
): Promise<boolean> {
  console.log(`\n${icons.warning()}  Worktree already exists: ${existingWorktree.path}`);

  let confirmed: boolean;
  if (existingWorktree.isDirty) {
    console.log(`${icons.warning()}  Warning: there are uncommitted changes`);
    confirmed = await deps.confirm("Discard changes and delete the worktree?");
  } else {
    confirmed = await deps.confirm("Delete the existing worktree and start a new session?");
  }

  if (!confirmed) {
    console.log("Cancelled.");
    return false;
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
      console.warn(`  ${icons.warning()}  preClean hook failed (continuing): ${result.message}`);
    }
  }

  // Delete existing worktree and branch
  console.log(`${icons.trash()}  Deleting existing worktree...`);
  await deps.removeWorktree(existingWorktree.path, existingWorktree.isDirty);
  console.log(`  ${icons.success()} Worktree deleted: ${existingWorktree.path}`);

  try {
    await deps.deleteLocalBranch(branchName, true);
    console.log(`  ${icons.success()} Branch deleted: ${branchName}`);
  } catch {
    // Ignore if branch does not exist
    console.log(`  ${icons.warning()}  Branch not found (skipping): ${branchName}`);
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
      console.warn(`  ${icons.warning()}  postClean hook failed (continuing): ${result.message}`);
    }
  }

  await deps.deleteSlot(existingWorktree.path);
  await deps.deleteSession(existingWorktree.path);

  console.log("");
  return true;
}

/**
 * Handle an existing branch (without worktree) for the target branch name.
 * Prompts user and deletes the branch if confirmed.
 * Returns true if creation should continue, false if cancelled/failed.
 */
async function handleExistingBranch(branchName: string, deps: CreateDeps): Promise<boolean> {
  const branchAlreadyExists = await deps.branchExists(branchName);
  if (!branchAlreadyExists) {
    return true;
  }

  console.log(`\n${icons.warning()}  Branch already exists: ${branchName}`);

  const confirmed = await deps.confirm("Delete the branch and create a new one?");
  if (!confirmed) {
    console.log("Cancelled.");
    return false;
  }

  console.log(`${icons.trash()}  Deleting existing branch...`);
  try {
    await deps.deleteLocalBranch(branchName, true);
    console.log(`  ${icons.success()} Branch deleted: ${branchName}`);
  } catch (e) {
    const errorMessage = getErrorMessage(e);
    console.log(`  ${icons.error()} Failed to delete branch: ${errorMessage}`);
    return false;
  }
  console.log("");
  return true;
}

/**
 * Build RollbackOptions from the current context.
 */
function buildRollbackOptions(
  worktreePath: string,
  repoRoot: string,
  config: ProjectConfig | null,
  slot: number | undefined,
  verbose: boolean,
  deleteSessionData: boolean,
  deps: CreateDeps,
): RollbackOptions {
  return {
    worktreePath,
    repoRoot,
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
    deleteSessionData,
  };
}

/**
 * Launch Claude Code in a new WezTerm pane.
 */
async function launchClaudeInPane(
  options: {
    worktreePath: string;
    repoRoot: string;
    config: ProjectConfig | null;
    claudeOptions: ClaudeOptions;
    slot?: number;
    verbose: boolean;
  },
  deps: CreateDeps,
): Promise<void> {
  const { worktreePath, repoRoot, config, claudeOptions, slot, verbose } = options;

  const claudeCommand = deps.buildClaudeCommand(claudeOptions);

  const runInPaneArgs: RunInPaneArgs = {
    worktreePath,
    repoRoot,
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
  };

  const payloadPath = join(tmpdir(), `claude-worktree-${randomUUID()}.json`);
  await writeFile(payloadPath, JSON.stringify(runInPaneArgs), { encoding: "utf-8", flag: "wx", mode: 0o600 });

  try {
    const paneIdStr = await deps.createPane({ keepFocus: true });
    const paneId = Number.parseInt(paneIdStr, 10);
    console.log(`${icons.window()} Created pane: ${paneId}`);

    await deps.sendCommand(paneIdStr, `${getSelfCommand()} _run-in-pane "${payloadPath}"`);

    // Save session metadata
    await deps.saveSession(worktreePath, {
      paneId,
      mode: "pane",
      startedAt: new Date().toISOString(),
    });

    console.log(`${icons.done()} Worktree created and Claude started in new pane`);
  } catch (error) {
    // Clean up temp file on failure (the pane side handles its own cleanup on success)
    await unlink(payloadPath).catch(() => {});
    await deps.performRollback(buildRollbackOptions(worktreePath, repoRoot, config, slot, verbose, false, deps));
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
    config: ProjectConfig | null;
    claudeOptions: ClaudeOptions;
    slot?: number;
    verbose: boolean;
  },
  deps: CreateDeps,
): Promise<void> {
  const { worktreePath, repoRoot, config, claudeOptions, slot, verbose } = options;

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
      console.error(`${icons.error()} postCreate hook failed: ${result.message}`);
      await deps.performRollback(buildRollbackOptions(worktreePath, repoRoot, config, slot, verbose, false, deps));
      return;
    }
  }

  // Launch Claude Code in current terminal
  console.log(`${icons.done()} Worktree created. Starting Claude Code...`);

  const claudeCommand = deps.buildClaudeCommand(claudeOptions);

  // Save session metadata before launching
  await deps.saveSession(worktreePath, {
    mode: "terminal",
    startedAt: new Date().toISOString(),
  });

  await spawnInteractive({ command: claudeCommand, cwd: worktreePath });

  // Mark session as completed after process exits
  await deps.completeSession(worktreePath);
}

// =============================================================================
// Main orchestration
// =============================================================================

export async function runCreate(args: CreateArgs, deps: CreateDeps = defaultDeps): Promise<void> {
  const { branchName, planFile, merge, draft, baseBranch, pane } = args;
  let { prompt } = args;

  // Check WezTerm availability when -pane is specified
  if (pane) {
    const available = await deps.checkWeztermAvailable();
    if (!available) {
      const installHint =
        process.platform === "darwin"
          ? "  brew install --cask wezterm    # macOS (Homebrew)"
          : process.platform === "linux"
            ? "  https://wezfurlong.org/wezterm/install/linux.html"
            : "  https://wezfurlong.org/wezterm/installation.html";

      throw new Error(
        "WezTerm CLI is not installed. The -pane option requires WezTerm.\n\n" +
          `Install WezTerm:\n${installHint}\n\n` +
          "Or run without -pane to use the current terminal:\n" +
          `  claude-worktree ${branchName} '...'`,
      );
    }
  }

  // Read prompt from plan file
  if (planFile) {
    prompt = await readPlanFile(planFile);
  }

  // Get git info
  const git = await deps.getGitContext();
  const worktreePath = deps.getWorktreePath(git.repoRoot, git.repoName, branchName);
  const effectiveBaseBranch = baseBranch ?? git.currentBranch;

  // Verify base branch exists when explicitly specified
  if (baseBranch) {
    const exists = await deps.verifyBranchRef(baseBranch);
    if (!exists) {
      throw new Error(
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
      await deps.fetchOrigin(effectiveBaseBranch);
      const remoteRef = `origin/${effectiveBaseBranch}`;
      const remoteExists = await deps.verifyBranchRef(remoteRef);
      if (remoteExists) {
        worktreeBaseBranch = remoteRef;
      } else {
        logWarn(`Remote branch not found: ${remoteRef} (using local branch)`);
      }
    }
  }

  const config = await deps.loadProjectConfig(git.repoRoot);

  // Fetch worktrees once and reuse for both limit check and existing worktree detection
  const { worktrees } = await deps.listWorktrees();
  const existingWorktree = worktrees.find((w) => w.branch === branchName) ?? null;

  // Check worktree limit
  if (config?.maxWorktrees != null) {
    const nonMainCount = worktrees.filter((w) => !w.isMain).length;
    const limitError = checkWorktreeLimit(config, nonMainCount, existingWorktree !== null);
    if (limitError) {
      console.log(limitError);
      process.exitCode = 1;
      return;
    }
  }

  // Display info
  console.log(`${icons.pin()} Current branch: ${git.currentBranch}`);
  if (baseBranch) {
    console.log(`${icons.tree()} Base branch: ${baseBranch}`);
  }
  console.log(`${icons.branch()} New branch: ${branchName}`);
  console.log(`${icons.folder()} Worktree path: ${worktreePath}`);
  if (planFile) {
    console.log(`${icons.clipboard()} Plan file: ${planFile}`);
  }
  if (merge) {
    console.log(`${icons.merge()} Auto-merge to: ${git.currentBranch}`);
  }
  if (draft) {
    console.log(`${icons.memo()} Draft PR to: ${effectiveBaseBranch}`);
  }
  if (args.pull) {
    console.log(`${icons.sparkle()} Pull: fetch latest from remote`);
  }

  // Dry-run: preview what would happen and exit
  if (args.dryRun) {
    logInfo(`\n--- Dry Run ---`);
    if (args.pull) {
      logInfo(`Fetch: git fetch origin ${effectiveBaseBranch}`);
      logInfo(`Worktree base: ${worktreeBaseBranch} (remote)`);
    }
    logInfo(`Git command: ${buildWorktreeCommand(branchName, worktreePath, worktreeBaseBranch)}`);
    logInfo(`Launch mode: ${pane ? "WezTerm pane" : "current terminal"}`);
    if (config?.postCreate) {
      const hookPreview = config.postCreate.replace("{path}", worktreePath).replace("{slot}", "<auto>");
      logInfo(`postCreate hook: ${hookPreview}`);
    }
    if (config?.preClean) {
      const hookPreview = config.preClean.replace("{path}", worktreePath).replace("{slot}", "<auto>");
      logInfo(`preClean hook: ${hookPreview}`);
    }
    if (config?.postClean) {
      const hookPreview = config.postClean.replace("{path}", worktreePath).replace("{slot}", "<auto>");
      logInfo(`postClean hook: ${hookPreview}`);
    }
    if (existingWorktree) {
      logInfo(`\nNote: Existing worktree at ${existingWorktree.path} would be replaced.`);
    }
    return;
  }

  // Handle existing worktree
  if (existingWorktree) {
    const shouldContinue = await handleExistingWorktree(
      existingWorktree,
      config,
      git.repoRoot,
      branchName,
      !!args.verbose,
      deps,
    );
    if (!shouldContinue) return;
  }

  // Handle existing branch (without worktree)
  if (!existingWorktree) {
    const shouldContinue = await handleExistingBranch(branchName, deps);
    if (!shouldContinue) return;
  }

  // Create worktree
  await deps.createWorktree(branchName, worktreePath, worktreeBaseBranch);

  // Allocate and persist slot if any hook uses {slot}
  let slot: number | undefined;
  if (config) {
    const anyHookUsesSlot = [config.postCreate, config.preClean, config.postClean].some((h) => h?.includes("{slot}"));
    if (anyHookUsesSlot) {
      slot = await deps.findAvailableSlot();
      await deps.saveSlot(worktreePath, slot);
    }
  }

  // Build Claude options (use local prompt which may be overridden by plan file)
  const claudeOptions = buildClaudeOptions({ ...args, prompt }, git, worktreePath, effectiveBaseBranch, branchName);

  // Launch Claude in pane or terminal
  if (pane) {
    await launchClaudeInPane(
      { worktreePath, repoRoot: git.repoRoot, config, claudeOptions, slot, verbose: !!args.verbose },
      deps,
    );
  } else {
    await launchClaudeInTerminal(
      { worktreePath, repoRoot: git.repoRoot, config, claudeOptions, slot, verbose: !!args.verbose },
      deps,
    );
  }
}
