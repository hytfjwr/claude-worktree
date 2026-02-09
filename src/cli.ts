import {
  getGitContext,
  getWorktreePath,
  createWorktree,
  findWorktreeByBranch,
  removeWorktree,
  deleteLocalBranch,
  branchExists,
} from "./git";
import { createPane, sendCommand, sendText, checkWeztermAvailable } from "./wezterm";
import { buildClaudeCommand } from "./claude";
import { executeClean, type CleanArgs } from "./clean";
import { executeList, type ListArgs } from "./list";
import { confirm } from "./prompt";
import { loadProjectConfig, buildHookCommand, runHook } from "./config";
import { findAvailableSlot } from "./slot";
import { extractOptions } from "./options";
import { startSpinner, createTailUpdater } from "./spinner";

export type { CleanArgs } from "./clean";
export type { ListArgs } from "./list";

export type CreateArgs = {
  branchName: string;
  prompt: string;
  planFile?: string;
  danger?: boolean;
  merge?: boolean;
  draft?: boolean;
  baseBranch?: string;
  pane?: boolean;
  verbose?: boolean;
};

export type Command =
  | { type: "help" }
  | { type: "create"; args: CreateArgs }
  | { type: "clean"; args: CleanArgs }
  | { type: "list"; args: ListArgs };

export function showHelp(): void {
  console.log(`claude-worktree - CLI for parallel development with WezTerm + git worktree + Claude Code

Usage:
  claude-worktree <branch-name> <prompt>
  claude-worktree <branch-name> --plan <file-path>
  claude-worktree list [options]
  claude-worktree clean [options]

Commands:
  <branch-name>  Create a new worktree with Claude Code
  list           List existing worktrees with status
  clean          Remove unnecessary worktrees

Arguments:
  <branch-name>  Branch name for the git worktree to create
  <prompt>       Prompt to pass to Claude Code

Options:
  -p, --pane       Open in a new WezTerm pane (requires WezTerm; default: run in current terminal)
  --plan <file>    Read prompt from a plan file (cannot be used with inline prompt)
  --base <branch>  Specify base branch (default: current branch)
  --danger         Skip workspace warning (uses --dangerously-skip-permissions)
  --merge          Auto-merge into base branch and cleanup after task completion
  --draft          Auto-create Draft PR after task completion (cannot be used with --merge)
  -v, --verbose    Show hook execution logs
  -h, --help       Show this help

List options:
  --json         Output as JSON
  -v, --verbose  Show full paths and details

Clean options:
  -f, --force    Skip confirmation prompt
  -a, --all      Show all worktrees for manual selection
  -n, --dry-run  Preview targets without deleting
  -v, --verbose  Show hook execution logs

Examples:
  claude-worktree feature/auth 'Implement authentication feature'
  claude-worktree feature/auth 'Implement authentication feature' -p
  claude-worktree fix/bug-123 'Fix login bug' --pane
  claude-worktree feature/api --plan ./plan.md
  claude-worktree feature/auth 'Implement authentication feature' --danger
  claude-worktree feature/auth 'Implement authentication feature' --merge
  claude-worktree feature/auth 'Implement authentication feature' --draft
  claude-worktree feature/auth 'Implement authentication feature' --draft --base main
  claude-worktree list
  claude-worktree list --json
  claude-worktree clean
  claude-worktree clean --dry-run`);
}

export function parseCreateArgs(args: string[]): CreateArgs {
  if (args.length < 1) {
    throw new Error(
      "Usage: claude-worktree <branch-name> <prompt>\n" +
        "       claude-worktree <branch-name> --plan <file-path>\n" +
        "Example: claude-worktree feature/auth 'Implement authentication feature'\n" +
        "         claude-worktree feature/auth --plan ./plan.md"
    );
  }

  const branchName = args[0];

  const { booleans, strings, remaining } = extractOptions(args.slice(1), {
    options: {
      pane:    { type: "boolean", flag: "--pane", alias: "-p" },
      danger:  { type: "boolean", flag: "--danger" },
      merge:   { type: "boolean", flag: "--merge" },
      draft:   { type: "boolean", flag: "--draft" },
      verbose: { type: "boolean", flag: "--verbose", alias: "-v" },
      baseBranch: { type: "string", flag: "--base", errorMessage: "--base requires a branch name argument" },
      planFile:   { type: "string", flag: "--plan", errorMessage: "--plan requires a file path argument" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "--help"],
    unknownErrorPrefix: "Unknown option",
  });

  const { pane, danger, merge, draft, verbose } = booleans;
  const { baseBranch, planFile } = strings;

  // Check for unknown options
  const unknownFlag = remaining.find((arg) => arg.startsWith("-"));
  if (unknownFlag) {
    throw new Error(`Unknown option: ${unknownFlag}`);
  }

  // Mutual exclusivity check for --merge and --draft
  if (merge && draft) {
    throw new Error(
      "Cannot use both --merge and --draft options. Please use one or the other."
    );
  }

  const inlinePrompt = remaining.join(" ");

  // Mutual exclusivity check: cannot specify both --plan and inline prompt
  if (planFile && inlinePrompt) {
    throw new Error(
      "Cannot use both --plan and inline prompt. Please use one or the other."
    );
  }

  // Require either inline prompt or --plan
  if (!inlinePrompt && !planFile) {
    throw new Error(
      "A prompt or --plan option is required.\n" +
        "Usage: claude-worktree <branch-name> <prompt>\n" +
        "       claude-worktree <branch-name> --plan <file-path>"
    );
  }

  return {
    branchName,
    prompt: inlinePrompt,
    planFile,
    danger,
    merge,
    draft,
    baseBranch,
    pane,
    verbose,
  };
}

export function parseCleanArgs(args: string[]): CleanArgs {
  const { booleans } = extractOptions(args, {
    options: {
      force:   { type: "boolean", flag: "--force", alias: "-f" },
      all:     { type: "boolean", flag: "--all",   alias: "-a" },
      dryRun:  { type: "boolean", flag: "--dry-run", alias: "-n" },
      verbose: { type: "boolean", flag: "--verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "--help"],
    unknownErrorPrefix: "Unknown option for clean command",
  });

  return {
    force: booleans.force,
    all: booleans.all,
    dryRun: booleans.dryRun,
    verbose: booleans.verbose,
  };
}

export function parseListArgs(args: string[]): ListArgs {
  const { booleans } = extractOptions(args, {
    options: {
      json:    { type: "boolean", flag: "--json" },
      verbose: { type: "boolean", flag: "--verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "--help"],
    unknownErrorPrefix: "Unknown option for list command",
  });

  return {
    json: booleans.json,
    verbose: booleans.verbose,
  };
}

export function parseArgs(args: string[]): Command {
  // Check for help flags
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    return { type: "help" };
  }

  if (args[0] === "list") {
    return { type: "list", args: parseListArgs(args.slice(1)) };
  }

  if (args[0] === "clean") {
    return { type: "clean", args: parseCleanArgs(args.slice(1)) };
  }

  return { type: "create", args: parseCreateArgs(args) };
}

// Re-export for backward compatibility
export type CliArgs = CreateArgs;

async function readPlanFile(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(`Plan file not found: ${filePath}`);
  }

  const content = await file.text();
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(`Plan file is empty: ${filePath}`);
  }

  return trimmed;
}

export async function runCreate(args: CreateArgs): Promise<void> {
  const { branchName, planFile, danger, merge, draft, baseBranch, pane } = args;
  let { prompt } = args;

  // Check WezTerm availability when --pane is specified
  if (pane) {
    const available = await checkWeztermAvailable();
    if (!available) {
      throw new Error(
        "WezTerm CLI is not installed. The --pane option requires WezTerm.\n" +
          "Install WezTerm: https://wezfurlong.org/wezterm/installation.html\n" +
          "Or run without --pane to use the current terminal."
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
      confirmed = await confirm(
        "Discard changes and delete the worktree?"
      );
    } else {
      confirmed = await confirm(
        "Delete the existing worktree and start a new session?"
      );
    }

    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }

    // preClean hook
    if (config?.preClean) {
      const hookCmd = buildHookCommand(config.preClean, { path: existingWorktree.path });
      const spinner = args.verbose ? null : startSpinner("Running preClean hook...");
      try {
        await runHook(hookCmd, git.repoRoot, {
          verbose: args.verbose,
          onLine: spinner ? createTailUpdater(spinner) : undefined,
        });
        spinner?.stop();
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

    console.log("");
  }

  // Check if branch exists without a worktree
  if (!existingWorktree) {
    const branchAlreadyExists = await branchExists(branchName);

    if (branchAlreadyExists) {
      console.log(`\n⚠️  Branch already exists: ${branchName}`);

      const confirmed = await confirm(
        "Delete the branch and create a new one?"
      );

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

  // postCreate hook
  if (config?.postCreate) {
    let slot: number | undefined;
    if (config.postCreate.includes("{slot}")) {
      slot = await findAvailableSlot();
    }
    const hookCmd = buildHookCommand(config.postCreate, { path: worktreePath, slot });
    const spinner = args.verbose ? null : startSpinner("Running postCreate hook...");
    try {
      await runHook(hookCmd, git.repoRoot, {
        verbose: args.verbose,
        onLine: spinner ? createTailUpdater(spinner) : undefined,
      });
      spinner?.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner?.fail("postCreate hook failed");
      console.error(`❌ postCreate hook failed: ${message}`);
      console.log("🗑️  Rolling back...");
      // Run preClean hook to clean up containers etc. before removing worktree
      if (config?.preClean) {
        const cleanCmd = buildHookCommand(config.preClean, { path: worktreePath });
        try {
          await runHook(cleanCmd, git.repoRoot, { verbose: args.verbose });
        } catch {
          console.warn("  ⚠️  preClean hook failed during rollback");
        }
      }
      try {
        await removeWorktree(worktreePath);
      } catch {
        console.warn("  ⚠️  Failed to rollback worktree");
      }
      return;
    }
  }

  // Build execution command
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
    // Create WezTerm pane and send command
    const paneId = await createPane({ keepFocus: true });
    console.log(`🪟 Created pane: ${paneId}`);

    const commands = [
      `cd "${worktreePath}"`,
      buildClaudeCommand(claudeOptions),
    ].join(" && ");

    await sendCommand(paneId, commands);

    // Send Enter to confirm the prompt after Claude starts
    await Bun.sleep(2000);
    await sendText(paneId, "\n");

    console.log("✅ Worktree created and Claude started in new pane");
  } else {
    // Launch Claude Code in current terminal
    console.log("✅ Worktree created. Starting Claude Code...");

    const commands = [
      `cd "${worktreePath}"`,
      buildClaudeCommand(claudeOptions),
    ].join(" && ");

    const proc = Bun.spawn(["sh", "-c", commands], {
      stdio: ["inherit", "inherit", "inherit"],
    });

    await proc.exited;
  }
}

export async function run(command: Command): Promise<void> {
  switch (command.type) {
    case "help":
      showHelp();
      break;
    case "create":
      await runCreate(command.args);
      break;
    case "list":
      await executeList(command.args);
      break;
    case "clean":
      await executeClean(command.args);
      break;
  }
}
