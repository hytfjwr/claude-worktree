import { executeClean } from "./commands/clean.ts";
import { runCreate } from "./commands/create.ts";
import { executeList } from "./commands/list.ts";
import { runResume } from "./commands/resume.ts";
import { executeRunInPane, parseRunInPaneArgs } from "./commands/run-in-pane.ts";
import { extractOptions } from "./options.ts";
import type { CleanArgs, Command, CreateArgs, ListArgs, ResumeArgs } from "./types.ts";
import { getVersion } from "./version.ts";

export function showHelp(): void {
  console.log(`claude-worktree - CLI for parallel development with WezTerm + git worktree + Claude Code

Usage:
  claude-worktree <branch-name> <prompt>
  claude-worktree <branch-name> -plan <file-path>
  claude-worktree resume [<branch-name>] [<prompt>]
  claude-worktree list [options]
  claude-worktree clean [options]

Commands:
  <branch-name>  Create a new worktree with Claude Code
  resume         Resume a Claude session in an existing worktree
  list           List existing worktrees with status
  clean          Remove unnecessary worktrees

Arguments:
  <branch-name>  Branch name for the git worktree to create
  <prompt>       Prompt to pass to Claude Code

Options:
  -p, -pane       Open in a new WezTerm pane (requires WezTerm; default: run in current terminal)
  -plan <file>    Read prompt from a plan file (cannot be used with inline prompt)
  -b, -base <branch>  Specify base branch (default: current branch)
  -d, -danger     Skip workspace warning (uses --dangerously-skip-permissions)
  -m, -merge      Auto-merge into base branch and cleanup after task completion
  -draft          Auto-create Draft PR after task completion (cannot be used with -merge)
  -n, -dry-run    Preview what would be created without executing
  -v, -verbose    Show hook execution logs
  -h, -help       Show this help
  -version, --version  Show version number

Resume options:
  -p, -pane      Open in a new WezTerm pane
  -d, -danger    Skip workspace warning (uses --dangerously-skip-permissions)
  -v, -verbose   Show verbose output

List options:
  -j, -json        Output as JSON
  -no-status       Hide Claude session status (shown by default)
  -v, -verbose     Show full paths and details

Clean options:
  -f, -force     Skip confirmation prompt
  -a, -all       Show all worktrees for manual selection
  -n, -dry-run   Preview targets without deleting
  -v, -verbose   Show hook execution logs

Examples:
  claude-worktree feature/auth 'Implement authentication feature'
  claude-worktree feature/auth 'Implement authentication feature' -p
  claude-worktree fix/bug-123 'Fix login bug' -pane
  claude-worktree feature/api -plan ./plan.md
  claude-worktree feature/auth 'Implement authentication feature' -danger
  claude-worktree feature/auth 'Implement authentication feature' -merge
  claude-worktree feature/auth 'Implement authentication feature' -draft
  claude-worktree feature/auth 'Implement authentication feature' -draft -base main
  claude-worktree feature/auth 'Prompt' -dry-run
  claude-worktree resume feature/auth
  claude-worktree resume feature/auth 'Continue implementation'
  claude-worktree resume
  claude-worktree list
  claude-worktree list -json
  claude-worktree clean
  claude-worktree clean -dry-run`);
}

export function showCreateHelp(): void {
  console.log(`claude-worktree <branch-name> - Create a new worktree and launch Claude Code

Creates a git worktree for a new branch, then starts a Claude Code session.
Optionally opens in a new WezTerm pane for parallel development.

Usage:
  claude-worktree <branch-name> <prompt>
  claude-worktree <branch-name> -plan <file-path>

Arguments:
  <branch-name>  Branch name for the git worktree to create
  <prompt>       Prompt to pass to Claude Code

Options:
  -p, -pane            Open in a new WezTerm pane (requires WezTerm; default: run in current terminal)
  -plan <file>         Read prompt from a plan file (cannot be used with inline prompt)
  -b, -base <branch>   Specify base branch (default: current branch)
  -d, -danger          Skip workspace warning (uses --dangerously-skip-permissions)
  -m, -merge           Auto-merge into base branch and cleanup after task completion
  -draft               Auto-create Draft PR after task completion (cannot be used with -merge)
  -n, -dry-run         Preview what would be created without executing
  -v, -verbose         Show hook execution logs
  -h, -help            Show this help

Examples:
  claude-worktree feature/auth 'Implement authentication feature'
  claude-worktree feature/auth 'Implement auth' -pane
  claude-worktree feature/auth -plan ./plan.md
  claude-worktree feature/auth 'Implement auth' -base develop
  claude-worktree feature/auth 'Implement auth' -merge
  claude-worktree feature/auth 'Implement auth' -draft -base main
  claude-worktree feature/auth 'Implement auth' -dry-run`);
}

export function showListHelp(): void {
  console.log(`claude-worktree list - List existing worktrees with status

Displays all git worktrees managed by claude-worktree, including branch info,
commit details, and optionally Claude session status.

Usage:
  claude-worktree list [options]

Options:
  -j, -json        Output as JSON (machine-readable format)
  -no-status       Hide Claude session status (shown by default)
  -v, -verbose     Show full paths and details
  -h, -help        Show this help

Examples:
  claude-worktree list
  claude-worktree list -no-status
  claude-worktree list -json
  claude-worktree list -verbose`);
}

export function showCleanHelp(): void {
  console.log(`claude-worktree clean - Remove unnecessary worktrees

Identifies worktrees that can be safely removed (merged branches, deleted remote
branches) and prompts for confirmation before deleting.

Usage:
  claude-worktree clean [options]

Options:
  -f, -force     Skip confirmation prompt
  -a, -all       Show all worktrees for manual selection
  -n, -dry-run   Preview targets without deleting
  -v, -verbose   Show hook execution logs
  -h, -help      Show this help

Examples:
  claude-worktree clean
  claude-worktree clean -dry-run
  claude-worktree clean -force
  claude-worktree clean -all`);
}

export function showResumeHelp(): void {
  console.log(`claude-worktree resume - Resume a Claude session in an existing worktree

Resumes a Claude Code session using --continue in an existing worktree.
If no branch name is specified, an interactive selection prompt is shown.

Usage:
  claude-worktree resume [<branch-name>] [<prompt>]

Arguments:
  <branch-name>  Branch name of the worktree to resume (optional)
  <prompt>       Additional prompt message for the resumed session (optional)

Options:
  -p, -pane      Open in a new WezTerm pane (requires WezTerm; default: run in current terminal)
  -d, -danger    Skip workspace warning (uses --dangerously-skip-permissions)
  -v, -verbose   Show verbose output
  -h, -help      Show this help

Examples:
  claude-worktree resume feature/auth
  claude-worktree resume feature/auth 'Continue the authentication implementation'
  claude-worktree resume
  claude-worktree resume feature/auth -pane`);
}

const CREATE_USAGE = "claude-worktree <branch-name> <prompt>\n" + "  claude-worktree <branch-name> -plan <file-path>";

/**
 * Validate a branch name against git's naming rules.
 * Returns an error message if invalid, or null if valid.
 * See: https://git-scm.com/docs/git-check-ref-format
 */
export function validateBranchName(name: string): string | null {
  if (name.startsWith("-")) {
    return `Invalid branch name: "${name}". Branch names cannot start with "-".`;
  }
  if (name.startsWith(".") || name.endsWith(".")) {
    return `Invalid branch name: "${name}". Branch names cannot start or end with ".".`;
  }
  // Check for path components starting with "." (e.g., feature/.hidden)
  const components = name.split("/");
  for (const component of components) {
    if (component.startsWith(".")) {
      return `Invalid branch name: "${name}". Path components cannot start with ".".`;
    }
  }
  if (name.endsWith(".lock")) {
    return `Invalid branch name: "${name}". Branch names cannot end with ".lock".`;
  }
  if (name.includes("..")) {
    return `Invalid branch name: "${name}". Branch names cannot contain "..".`;
  }
  if (name.includes("//")) {
    return `Invalid branch name: "${name}". Branch names cannot contain consecutive slashes.`;
  }
  if (name.endsWith("/")) {
    return `Invalid branch name: "${name}". Branch names cannot end with "/".`;
  }
  if (name.includes("@{")) {
    return `Invalid branch name: "${name}". Branch names cannot contain "@{".`;
  }
  if (name === "@") {
    return `Invalid branch name: "${name}". Branch name cannot be "@".`;
  }
  if (name.includes("\\")) {
    return `Invalid branch name: "${name}". Branch names cannot contain backslashes.`;
  }
  // Check for spaces, control characters (~, ^, :, ?, *, [)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching git-forbidden control chars
  const invalidCharMatch = name.match(/[\s~^:?*[\x00-\x1f\x7f]/);
  if (invalidCharMatch) {
    const char = invalidCharMatch[0];
    const displayChar = char.trim() === "" ? "whitespace" : `"${char}"`;
    return `Invalid branch name: "${name}". Branch names cannot contain ${displayChar}.`;
  }
  return null;
}

export function parseCreateArgs(args: string[]): CreateArgs {
  if (args.length < 1) {
    throw new Error(
      `Usage:\n  ${CREATE_USAGE}\n\n` +
        "Example:\n" +
        "  claude-worktree feature/auth 'Implement authentication feature'\n" +
        "  claude-worktree feature/auth -plan ./plan.md",
    );
  }

  const branchName = args[0];

  // Validate branch name
  const branchError = validateBranchName(branchName);
  if (branchError) {
    throw new Error(branchError);
  }

  const { booleans, strings, remaining } = extractOptions(args.slice(1), {
    options: {
      pane: { type: "boolean", flag: "-pane", alias: "-p" },
      danger: { type: "boolean", flag: "-danger", alias: "-d" },
      merge: { type: "boolean", flag: "-merge", alias: "-m" },
      draft: { type: "boolean", flag: "-draft" },
      dryRun: { type: "boolean", flag: "-dry-run", alias: "-n" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
      baseBranch: { type: "string", flag: "-base", alias: "-b", errorMessage: "-base requires a branch name argument" },
      planFile: { type: "string", flag: "-plan", errorMessage: "-plan requires a file path argument" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help"],
    unknownErrorPrefix: "Unknown option",
  });

  const { pane, danger, merge, draft, dryRun, verbose } = booleans;
  const { baseBranch, planFile } = strings;

  // Check for unknown options
  const unknownFlag = remaining.find((arg) => arg.startsWith("-"));
  if (unknownFlag) {
    throw new Error(`Unknown option: ${unknownFlag}`);
  }

  // Mutual exclusivity check for -merge and -draft
  if (merge && draft) {
    throw new Error(
      "Cannot use both -merge and -draft options.\n\n" +
        "  -merge  Auto-merge into base branch and cleanup after task completion\n" +
        "  -draft  Auto-create a Draft PR after task completion\n\n" +
        "Example:\n" +
        "  claude-worktree feature/auth 'Implement auth' -merge\n" +
        "  claude-worktree feature/auth 'Implement auth' -draft -base main",
    );
  }

  const inlinePrompt = remaining.join(" ").trim();

  // Mutual exclusivity check: cannot specify both -plan and inline prompt
  if (planFile && inlinePrompt) {
    throw new Error("Cannot use both -plan and inline prompt. Please use one or the other.");
  }

  // Require either inline prompt or -plan
  if (!inlinePrompt && !planFile) {
    throw new Error(`A prompt or -plan option is required.\n\nUsage:\n  ${CREATE_USAGE}`);
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
    dryRun,
  };
}

export function parseResumeArgs(args: string[]): ResumeArgs {
  const { booleans, remaining } = extractOptions(args, {
    options: {
      pane: { type: "boolean", flag: "-pane", alias: "-p" },
      danger: { type: "boolean", flag: "-danger", alias: "-d" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help"],
    unknownErrorPrefix: "Unknown option for resume command",
  });

  const { pane, danger, verbose } = booleans;

  // First remaining arg that doesn't start with - is branchName, rest is prompt
  const branchName = remaining.length > 0 ? remaining[0] : undefined;
  const prompt = remaining.length > 1 ? remaining.slice(1).join(" ").trim() || undefined : undefined;

  return {
    branchName,
    prompt,
    danger,
    pane,
    verbose,
  };
}

export function parseCleanArgs(args: string[]): CleanArgs {
  const { booleans } = extractOptions(args, {
    options: {
      force: { type: "boolean", flag: "-force", alias: "-f" },
      all: { type: "boolean", flag: "-all", alias: "-a" },
      dryRun: { type: "boolean", flag: "-dry-run", alias: "-n" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help"],
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
      json: { type: "boolean", flag: "-json", alias: "-j" },
      noStatus: { type: "boolean", flag: "-no-status" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help"],
    unknownErrorPrefix: "Unknown option for list command",
  });

  return {
    json: booleans.json,
    verbose: booleans.verbose,
    noStatus: booleans.noStatus,
  };
}

const KNOWN_COMMANDS = ["list", "clean", "resume"] as const;

function hasHelpFlag(subArgs: string[]): boolean {
  return subArgs.includes("-h") || subArgs.includes("-help");
}

function parseSubCommand(commandName: string, subArgs: string[]): Command | null {
  switch (commandName) {
    case "list":
      return hasHelpFlag(subArgs)
        ? { type: "help", commandHelp: "list" }
        : { type: "list", args: parseListArgs(subArgs) };
    case "clean":
      return hasHelpFlag(subArgs)
        ? { type: "help", commandHelp: "clean" }
        : { type: "clean", args: parseCleanArgs(subArgs) };
    case "resume":
      return hasHelpFlag(subArgs)
        ? { type: "help", commandHelp: "resume" }
        : { type: "resume", args: parseResumeArgs(subArgs) };
    default:
      return null;
  }
}

export function parseArgs(args: string[]): Command {
  // Internal sub-command: must be checked before help flags
  if (args[0] === "_run-in-pane") {
    if (args.length !== 2) {
      throw new Error("_run-in-pane requires exactly one payload file path argument");
    }
    return { type: "_run-in-pane", payloadPath: args[1] };
  }

  // Version flag: checked before help and before empty-args check
  // Only match when it's the sole argument to avoid false positives on positional args
  if (args.length === 1 && (args[0] === "-version" || args[0] === "--version")) {
    return { type: "version" };
  }

  // No args → global help
  if (args.length === 0) {
    return { type: "help" };
  }

  // Named sub-commands: list, clean, resume
  const subCommand = parseSubCommand(args[0], args.slice(1));
  if (subCommand) {
    return subCommand;
  }

  // Global help flags (only when not a sub-command)
  if (hasHelpFlag(args)) {
    // If the first arg looks like a branch name (create command), show create help
    const isKnown = (KNOWN_COMMANDS as readonly string[]).includes(args[0]);
    if (args.length >= 1 && !args[0].startsWith("-") && !isKnown) {
      return { type: "help", commandHelp: "create" };
    }
    return { type: "help" };
  }

  // Single non-flag argument that isn't a known command → missing prompt for branch
  if (args.length === 1 && !args[0].startsWith("-")) {
    throw new Error(
      `Missing prompt for branch "${args[0]}".\n\n` +
        `Usage:\n  claude-worktree ${args[0]} '<prompt>'\n  claude-worktree ${args[0]} -plan <file-path>`,
    );
  }

  return { type: "create", args: parseCreateArgs(args) };
}

export async function run(command: Command): Promise<void> {
  switch (command.type) {
    case "help":
      if (command.commandHelp === "create") {
        showCreateHelp();
      } else if (command.commandHelp === "list") {
        showListHelp();
      } else if (command.commandHelp === "clean") {
        showCleanHelp();
      } else if (command.commandHelp === "resume") {
        showResumeHelp();
      } else {
        showHelp();
      }
      break;
    case "version":
      console.log(getVersion());
      break;
    case "create":
      await runCreate(command.args);
      break;
    case "resume":
      await runResume(command.args);
      break;
    case "list":
      await executeList(command.args);
      break;
    case "clean":
      await executeClean(command.args);
      break;
    case "_run-in-pane": {
      const runInPaneArgs = await parseRunInPaneArgs(command.payloadPath);
      await executeRunInPane(runInPaneArgs);
      break;
    }
  }
}
