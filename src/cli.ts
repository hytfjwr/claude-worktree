import { executeClean } from "./commands/clean.ts";
import { runCreate } from "./commands/create.ts";
import { executeList } from "./commands/list.ts";
import { executeListWatch } from "./commands/list-watch.ts";
import { runResume } from "./commands/resume.ts";
import { executeRunInPane, parseRunInPaneArgs } from "./commands/run-in-pane.ts";
import { UsageError } from "./core/errors.ts";
import { findClosestCommand } from "./core/suggest.ts";
import { extractOptions } from "./options.ts";
import type { CleanArgs, Command, CreateArgs, HelpSpec, ListArgs, ResumeArgs } from "./types/index.ts";
import { renderHelp } from "./ui/help.ts";
import { createQuietLogger, logInfo, setLogger } from "./ui/logger.ts";
import { setQuietMode } from "./ui/spinner.ts";
import { getVersion } from "./version.ts";

const GLOBAL_HELP: HelpSpec = {
  name: "claude-worktree",
  tagline: "CLI for parallel development with git worktree + Claude Code",
  usage: [
    "claude-worktree <branch-name> <prompt>",
    "claude-worktree <branch-name> -plan <file-path>",
    "claude-worktree resume [<branch-name>] [<prompt>]",
    "claude-worktree list [options]",
    "claude-worktree clean [<branch-name>...] [options]",
  ],
  sections: [
    {
      title: "Commands",
      kind: "commands",
      entries: [
        { arg: "<branch-name>", description: "Create a new worktree with Claude Code" },
        { arg: "resume", description: "Resume a Claude session in an existing worktree" },
        { arg: "list", description: "List existing worktrees with status" },
        { arg: "clean", description: "Remove unnecessary worktrees" },
      ],
    },
    {
      title: "Arguments",
      kind: "arguments",
      entries: [
        { arg: "<branch-name>", description: "Branch name for the git worktree to create" },
        { arg: "<prompt>", description: "Prompt to pass to Claude Code" },
      ],
    },
    {
      title: "Options",
      kind: "options",
      entries: [
        {
          flags: "-p, -pane",
          description: "Open in a new pane (requires WezTerm, tmux or herdr; default: run in current terminal)",
        },
        { flags: "-plan <file>", description: "Read prompt from a plan file (cannot be used with inline prompt)" },
        { flags: "-b, -base <branch>", description: "Specify base branch (default: current branch)" },
        { flags: "-model <name>", description: "Language model to use (e.g. sonnet, opus; passed to claude --model)" },
        {
          flags: "-d, -danger",
          description: "Run Claude without permission prompts (uses --dangerously-skip-permissions)",
        },
        {
          flags: "-m, -merge",
          description:
            "Auto-merge into base branch and cleanup after task completion (cannot be used with -draft or -pr)",
        },
        {
          flags: "-draft",
          description: "Auto-create Draft PR after task completion (cannot be used with -merge or -pr)",
        },
        { flags: "-pr", description: "Auto-create PR after task completion (cannot be used with -merge or -draft)" },
        { flags: "-pull", description: "Fetch latest base branch from remote before creating worktree" },
        { flags: "-n, -dry-run", description: "Preview what would be created without executing" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show hook execution logs" },
        { flags: "-h, -help, --help", description: "Show this help" },
        { flags: "-version, --version", description: "Show version number" },
      ],
    },
    {
      title: "Resume options",
      kind: "options",
      entries: [
        { flags: "-p, -pane", description: "Open in a new pane (requires WezTerm, tmux or herdr)" },
        {
          flags: "-d, -danger",
          description: "Run Claude without permission prompts (uses --dangerously-skip-permissions)",
        },
        { flags: "-model <name>", description: "Language model to use (passed to claude --model)" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show verbose output" },
      ],
    },
    {
      title: "List options",
      kind: "options",
      entries: [
        { flags: "-j, -json", description: "Output as JSON" },
        { flags: "-no-status", description: "Hide Claude session status (shown by default)" },
        {
          flags: "-fetch",
          description:
            "Fetch from remote before listing (default: local only; with -watch, only the first refresh fetches)",
        },
        {
          flags: "-w, -watch",
          description: "Redraw the list on an interval until you quit (requires a TTY; cannot be used with -json)",
        },
        { flags: "-interval <seconds>", description: "Refresh interval for -watch (default: 2, min: 1, max: 60)" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show full paths and details" },
      ],
    },
    {
      title: "Clean options",
      kind: "options",
      entries: [
        { arg: "<branch-name>", description: "Specific branch(es) to clean (can specify multiple)" },
        {
          flags: "-f, -force",
          description:
            "Skip confirmation prompt (worktrees with uncommitted changes or unpushed commits are skipped unless -discard-unsaved is given)",
        },
        {
          flags: "-discard-unsaved",
          description: "Let -force delete worktrees with uncommitted changes or unpushed commits (destructive)",
        },
        { flags: "-a, -all", description: "Show all worktrees for manual selection" },
        { flags: "-n, -dry-run", description: "Preview targets without deleting" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show hook execution logs" },
      ],
    },
    {
      title: "Examples",
      kind: "examples",
      entries: [
        { arg: "claude-worktree feature/auth 'Implement authentication feature'" },
        { arg: "claude-worktree feature/auth 'Implement authentication feature' -p" },
        { arg: "claude-worktree fix/bug-123 'Fix login bug' -pane" },
        { arg: "claude-worktree feature/api -plan ./plan.md" },
        { arg: "claude-worktree feature/auth 'Implement authentication feature' -danger" },
        { arg: "claude-worktree feature/auth 'Implement authentication feature' -merge" },
        { arg: "claude-worktree feature/auth 'Implement authentication feature' -draft" },
        { arg: "claude-worktree feature/auth 'Implement authentication feature' -draft -base main" },
        { arg: "claude-worktree feature/auth 'Implement authentication feature' -pr" },
        { arg: "claude-worktree feature/auth 'Implement authentication feature' -pr -base main" },
        { arg: "claude-worktree feature/auth 'Prompt' -dry-run" },
        { arg: "claude-worktree resume feature/auth" },
        { arg: "claude-worktree resume feature/auth 'Continue implementation'" },
        { arg: "claude-worktree resume" },
        { arg: "claude-worktree list" },
        { arg: "claude-worktree list -json" },
        { arg: "claude-worktree list -watch" },
        { arg: "claude-worktree clean" },
        { arg: "claude-worktree clean feature/auth" },
        { arg: "claude-worktree clean feature/auth fix/bug-123" },
        { arg: "claude-worktree clean feature/auth -force -discard-unsaved" },
        { arg: "claude-worktree clean -dry-run" },
      ],
    },
  ],
};

export function showHelp(): void {
  logInfo(renderHelp(GLOBAL_HELP));
}

const CREATE_HELP: HelpSpec = {
  name: "claude-worktree <branch-name>",
  tagline: "Create a new worktree and launch Claude Code",
  description:
    "Creates a git worktree for a new branch, then starts a Claude Code session. Optionally opens in a new pane (WezTerm, tmux or herdr) for parallel development.",
  usage: ["claude-worktree <branch-name> <prompt>", "claude-worktree <branch-name> -plan <file-path>"],
  sections: [
    {
      title: "Arguments",
      kind: "arguments",
      entries: [
        { arg: "<branch-name>", description: "Branch name for the git worktree to create" },
        { arg: "<prompt>", description: "Prompt to pass to Claude Code" },
      ],
    },
    {
      title: "Options",
      kind: "options",
      entries: [
        {
          flags: "-p, -pane",
          description: "Open in a new pane (requires WezTerm, tmux or herdr; default: run in current terminal)",
        },
        { flags: "-plan <file>", description: "Read prompt from a plan file (cannot be used with inline prompt)" },
        { flags: "-b, -base <branch>", description: "Specify base branch (default: current branch)" },
        { flags: "-model <name>", description: "Language model to use (e.g. sonnet, opus; passed to claude --model)" },
        {
          flags: "-d, -danger",
          description: "Run Claude without permission prompts (uses --dangerously-skip-permissions)",
        },
        {
          flags: "-m, -merge",
          description:
            "Auto-merge into base branch and cleanup after task completion (cannot be used with -draft or -pr)",
        },
        {
          flags: "-draft",
          description: "Auto-create Draft PR after task completion (cannot be used with -merge or -pr)",
        },
        { flags: "-pr", description: "Auto-create PR after task completion (cannot be used with -merge or -draft)" },
        { flags: "-pull", description: "Fetch latest base branch from remote before creating worktree" },
        { flags: "-n, -dry-run", description: "Preview what would be created without executing" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show hook execution logs" },
        { flags: "-h, -help, --help", description: "Show this help" },
      ],
    },
    {
      title: "Examples",
      kind: "examples",
      entries: [
        { arg: "claude-worktree feature/auth 'Implement authentication feature'" },
        { arg: "claude-worktree feature/auth 'Implement auth' -pane" },
        { arg: "claude-worktree feature/auth -plan ./plan.md" },
        { arg: "claude-worktree feature/auth 'Implement auth' -base develop" },
        { arg: "claude-worktree feature/auth 'Implement auth' -merge" },
        { arg: "claude-worktree feature/auth 'Implement auth' -draft -base main" },
        { arg: "claude-worktree feature/auth 'Implement auth' -pr -base main" },
        { arg: "claude-worktree feature/auth 'Implement auth' -dry-run" },
      ],
    },
  ],
};

export function showCreateHelp(): void {
  logInfo(renderHelp(CREATE_HELP));
}

const LIST_HELP: HelpSpec = {
  name: "claude-worktree list",
  tagline: "List existing worktrees with status",
  description:
    "Displays all git worktrees managed by claude-worktree, including branch info, commit details, and optionally Claude session status. With -watch, the list is redrawn on an interval in an alternate screen buffer until you quit.",
  usage: ["claude-worktree list [options]"],
  sections: [
    {
      title: "Options",
      kind: "options",
      entries: [
        { flags: "-j, -json", description: "Output as JSON (machine-readable format)" },
        { flags: "-no-status", description: "Hide Claude session status (shown by default)" },
        {
          flags: "-fetch",
          description:
            "Fetch from remote before listing (default: local only; with -watch, only the first refresh fetches)",
        },
        {
          flags: "-w, -watch",
          description: "Redraw the list on an interval until you quit (requires a TTY; cannot be used with -json)",
        },
        { flags: "-interval <seconds>", description: "Refresh interval for -watch (default: 2, min: 1, max: 60)" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show full paths and details" },
        { flags: "-h, -help, --help", description: "Show this help" },
      ],
    },
    {
      title: "Examples",
      kind: "examples",
      entries: [
        { arg: "claude-worktree list" },
        { arg: "claude-worktree list -fetch" },
        { arg: "claude-worktree list -no-status" },
        { arg: "claude-worktree list -json" },
        { arg: "claude-worktree list -watch" },
        { arg: "claude-worktree list -watch -interval 5" },
        { arg: "claude-worktree list -verbose" },
      ],
    },
  ],
};

export function showListHelp(): void {
  logInfo(renderHelp(LIST_HELP));
}

const CLEAN_HELP: HelpSpec = {
  name: "claude-worktree clean",
  tagline: "Remove unnecessary worktrees",
  description:
    "Identifies worktrees that can be safely removed (merged branches, deleted remote branches) and prompts for confirmation before deleting. Specify branch names to clean specific worktrees directly.",
  usage: ["claude-worktree clean [<branch-name>...] [options]"],
  sections: [
    {
      title: "Arguments",
      kind: "arguments",
      entries: [{ arg: "<branch-name>", description: "Specific branch(es) to clean (can specify multiple)" }],
    },
    {
      title: "Options",
      kind: "options",
      entries: [
        {
          flags: "-f, -force",
          description:
            "Skip confirmation prompt (worktrees with uncommitted changes or unpushed commits are skipped unless -discard-unsaved is given)",
        },
        {
          flags: "-discard-unsaved",
          description: "Let -force delete worktrees with uncommitted changes or unpushed commits (destructive)",
        },
        { flags: "-a, -all", description: "Show all worktrees for manual selection" },
        { flags: "-n, -dry-run", description: "Preview targets without deleting" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show hook execution logs" },
        { flags: "-h, -help, --help", description: "Show this help" },
      ],
    },
    {
      title: "Examples",
      kind: "examples",
      entries: [
        { arg: "claude-worktree clean" },
        { arg: "claude-worktree clean feature/auth" },
        { arg: "claude-worktree clean feature/auth fix/bug-123" },
        { arg: "claude-worktree clean feature/auth -force" },
        { arg: "claude-worktree clean feature/auth -force -discard-unsaved" },
        { arg: "claude-worktree clean -dry-run" },
        { arg: "claude-worktree clean -all" },
      ],
    },
  ],
};

export function showCleanHelp(): void {
  logInfo(renderHelp(CLEAN_HELP));
}

const RESUME_HELP: HelpSpec = {
  name: "claude-worktree resume",
  tagline: "Resume a Claude session in an existing worktree",
  description:
    "Resumes a Claude Code session using --continue in an existing worktree. If no branch name is specified, an interactive selection prompt is shown.",
  usage: ["claude-worktree resume [<branch-name>] [<prompt>]"],
  sections: [
    {
      title: "Arguments",
      kind: "arguments",
      entries: [
        { arg: "<branch-name>", description: "Branch name of the worktree to resume (optional)" },
        { arg: "<prompt>", description: "Additional prompt message for the resumed session (optional)" },
      ],
    },
    {
      title: "Options",
      kind: "options",
      entries: [
        {
          flags: "-p, -pane",
          description: "Open in a new pane (requires WezTerm, tmux or herdr; default: run in current terminal)",
        },
        {
          flags: "-d, -danger",
          description: "Run Claude without permission prompts (uses --dangerously-skip-permissions)",
        },
        { flags: "-model <name>", description: "Language model to use (passed to claude --model)" },
        { flags: "-q, -quiet", description: "Suppress informational output (errors only)" },
        { flags: "-v, -verbose", description: "Show verbose output" },
        { flags: "-h, -help, --help", description: "Show this help" },
      ],
    },
    {
      title: "Examples",
      kind: "examples",
      entries: [
        { arg: "claude-worktree resume feature/auth" },
        { arg: "claude-worktree resume feature/auth 'Continue the authentication implementation'" },
        { arg: "claude-worktree resume" },
        { arg: "claude-worktree resume feature/auth -pane" },
      ],
    },
  ],
};

export function showResumeHelp(): void {
  logInfo(renderHelp(RESUME_HELP));
}

const CREATE_USAGE = "claude-worktree <branch-name> <prompt>\n" + "  claude-worktree <branch-name> -plan <file-path>";

/**
 * Validate a branch name against git's naming rules.
 * Returns an error message if invalid, or null if valid.
 * See: https://git-scm.com/docs/git-check-ref-format
 */
export function validateBranchName(name: string, label = "branch name"): string | null {
  const prefix = `Invalid ${label}`;
  if (name.startsWith("-")) {
    return `${prefix}: "${name}". Branch names cannot start with "-".`;
  }
  if (name.startsWith(".") || name.endsWith(".")) {
    return `${prefix}: "${name}". Branch names cannot start or end with ".".`;
  }
  // Check for path components starting with "." (e.g., feature/.hidden)
  const components = name.split("/");
  for (const component of components) {
    if (component.startsWith(".")) {
      return `${prefix}: "${name}". Path components cannot start with ".".`;
    }
  }
  if (name.endsWith(".lock")) {
    return `${prefix}: "${name}". Branch names cannot end with ".lock".`;
  }
  if (name.includes("..")) {
    return `${prefix}: "${name}". Branch names cannot contain "..".`;
  }
  if (name.includes("//")) {
    return `${prefix}: "${name}". Branch names cannot contain consecutive slashes.`;
  }
  if (name.endsWith("/")) {
    return `${prefix}: "${name}". Branch names cannot end with "/".`;
  }
  if (name.includes("@{")) {
    return `${prefix}: "${name}". Branch names cannot contain "@{".`;
  }
  if (name === "@") {
    return `${prefix}: "${name}". Branch name cannot be "@".`;
  }
  if (name.includes("\\")) {
    return `${prefix}: "${name}". Branch names cannot contain backslashes.`;
  }
  if (name.startsWith("/")) {
    return `${prefix}: "${name}". Branch names cannot start with "/".`;
  }
  if (name.includes("{") || name.includes("}")) {
    return `${prefix}: "${name}". Branch names cannot contain curly braces.`;
  }
  // Check for spaces, control characters (~, ^, :, ?, *, [)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching git-forbidden control chars
  const invalidCharMatch = name.match(/[\s~^:?*[\x00-\x1f\x7f]/);
  if (invalidCharMatch) {
    const char = invalidCharMatch[0];
    const displayChar = char.trim() === "" ? "whitespace" : `"${char}"`;
    return `${prefix}: "${name}". Branch names cannot contain ${displayChar}.`;
  }
  return null;
}

function assertValidBranchName(name: string, label?: string): void {
  const error = validateBranchName(name, label);
  if (error) {
    throw new UsageError(error);
  }
}

export function parseCreateArgs(args: string[]): CreateArgs {
  if (args.length < 1) {
    throw new UsageError(
      `Usage:\n  ${CREATE_USAGE}\n\n` +
        "Example:\n" +
        "  claude-worktree feature/auth 'Implement authentication feature'\n" +
        "  claude-worktree feature/auth -plan ./plan.md",
    );
  }

  const branchName = args[0];

  assertValidBranchName(branchName);

  const { booleans, strings, remaining } = extractOptions(args.slice(1), {
    options: {
      pane: { type: "boolean", flag: "-pane", alias: "-p" },
      danger: { type: "boolean", flag: "-danger", alias: "-d" },
      merge: { type: "boolean", flag: "-merge", alias: "-m" },
      draft: { type: "boolean", flag: "-draft" },
      pr: { type: "boolean", flag: "-pr" },
      pull: { type: "boolean", flag: "-pull" },
      dryRun: { type: "boolean", flag: "-dry-run", alias: "-n" },
      quiet: { type: "boolean", flag: "-quiet", alias: "-q" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
      baseBranch: { type: "string", flag: "-base", alias: "-b", errorMessage: "-base requires a branch name argument" },
      planFile: { type: "string", flag: "-plan", errorMessage: "-plan requires a file path argument" },
      model: { type: "string", flag: "-model", errorMessage: "-model requires a model name argument" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help", "--help"],
    unknownErrorPrefix: "Unknown option",
  });

  const { pane, danger, merge, draft, pr, pull, dryRun, quiet, verbose } = booleans;
  const { baseBranch, planFile, model } = strings;

  if (baseBranch) {
    assertValidBranchName(baseBranch, "base branch name");
  }

  // Mutual exclusivity check for -merge, -draft, and -pr
  const exclusiveFlags = [merge && "-merge", draft && "-draft", pr && "-pr"].filter(Boolean) as string[];

  if (exclusiveFlags.length > 1) {
    throw new UsageError(
      `Cannot use both ${exclusiveFlags[0]} and ${exclusiveFlags[1]} options.\n\n` +
        "  -merge  Auto-merge into base branch and cleanup after task completion\n" +
        "  -draft  Auto-create a Draft PR after task completion\n" +
        "  -pr     Auto-create a PR after task completion\n\n" +
        "These options are mutually exclusive. Use only one.",
    );
  }

  const inlinePrompt = remaining.join(" ").trim();

  // Mutual exclusivity check: cannot specify both -plan and inline prompt
  if (planFile && inlinePrompt) {
    throw new UsageError("Cannot use both -plan and inline prompt. Please use one or the other.");
  }

  // Require either inline prompt or -plan
  if (!inlinePrompt && !planFile) {
    throw new UsageError(`A prompt or -plan option is required.\n\nUsage:\n  ${CREATE_USAGE}`);
  }

  return {
    branchName,
    prompt: inlinePrompt,
    planFile,
    danger,
    merge,
    draft,
    pr,
    pull,
    baseBranch,
    model,
    pane,
    quiet,
    verbose,
    dryRun,
  };
}

export function parseResumeArgs(args: string[]): ResumeArgs {
  const { booleans, strings, remaining } = extractOptions(args, {
    options: {
      pane: { type: "boolean", flag: "-pane", alias: "-p" },
      danger: { type: "boolean", flag: "-danger", alias: "-d" },
      quiet: { type: "boolean", flag: "-quiet", alias: "-q" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
      model: { type: "string", flag: "-model", errorMessage: "-model requires a model name argument" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help", "--help"],
    unknownErrorPrefix: "Unknown option for resume command",
  });

  const { pane, danger, quiet, verbose } = booleans;

  // First remaining arg that doesn't start with - is branchName, rest is prompt
  const branchName = remaining.length > 0 ? remaining[0] : undefined;
  const prompt = remaining.length > 1 ? remaining.slice(1).join(" ").trim() || undefined : undefined;

  if (branchName) {
    assertValidBranchName(branchName);
  }

  return {
    branchName,
    prompt,
    danger,
    model: strings.model,
    pane,
    quiet,
    verbose,
  };
}

export function parseCleanArgs(args: string[]): CleanArgs {
  const { booleans, remaining } = extractOptions(args, {
    options: {
      force: { type: "boolean", flag: "-force", alias: "-f" },
      discardUnsaved: { type: "boolean", flag: "-discard-unsaved" },
      all: { type: "boolean", flag: "-all", alias: "-a" },
      dryRun: { type: "boolean", flag: "-dry-run", alias: "-n" },
      quiet: { type: "boolean", flag: "-quiet", alias: "-q" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help", "--help"],
    unknownErrorPrefix: "Unknown option for clean command",
  });

  const branches = remaining;

  if (branches.length > 0 && booleans.all) {
    throw new UsageError("Cannot use both branch names and -all option.");
  }

  return {
    force: booleans.force,
    discardUnsaved: booleans.discardUnsaved,
    all: booleans.all,
    dryRun: booleans.dryRun,
    quiet: booleans.quiet,
    verbose: booleans.verbose,
    branches,
  };
}

const DEFAULT_WATCH_INTERVAL_SECONDS = 2;
const MIN_WATCH_INTERVAL_SECONDS = 1;
const MAX_WATCH_INTERVAL_SECONDS = 60;

/** `-watch` draws a full-screen view and reads key presses, so both ends must be a TTY. */
function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function parseWatchInterval(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_WATCH_INTERVAL_SECONDS;
  }
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`-interval requires a whole number of seconds (got "${raw}").`);
  }
  const seconds = Number.parseInt(raw, 10);
  if (seconds < MIN_WATCH_INTERVAL_SECONDS || seconds > MAX_WATCH_INTERVAL_SECONDS) {
    throw new UsageError(
      `-interval must be between ${MIN_WATCH_INTERVAL_SECONDS} and ${MAX_WATCH_INTERVAL_SECONDS} seconds (got "${raw}").`,
    );
  }
  return seconds;
}

export function parseListArgs(args: string[], isTty: () => boolean = isInteractiveTerminal): ListArgs {
  const { booleans, strings, remaining } = extractOptions(args, {
    options: {
      json: { type: "boolean", flag: "-json", alias: "-j" },
      noStatus: { type: "boolean", flag: "-no-status" },
      fetch: { type: "boolean", flag: "-fetch" },
      watch: { type: "boolean", flag: "-watch", alias: "-w" },
      interval: { type: "string", flag: "-interval", errorMessage: "-interval requires a number of seconds argument" },
      quiet: { type: "boolean", flag: "-quiet", alias: "-q" },
      verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "-help", "--help"],
    unknownErrorPrefix: "Unknown option for list command",
  });

  // "list" is a reserved sub-command name, so a stray positional is most likely a
  // create command whose branch name collided with it — say so instead of ignoring it.
  if (remaining.length > 0) {
    const label = remaining.length === 1 ? "argument" : "arguments";
    const quoted = remaining.map((arg) => `"${arg}"`).join(", ");
    throw new UsageError(
      `Unexpected ${label} for list command: ${quoted}\n\n` +
        "The list command takes no positional arguments.\n\n" +
        "Usage:\n  claude-worktree list [options]\n\n" +
        'Note: "list" is a reserved sub-command name and cannot be used as a branch name.',
    );
  }

  const intervalSeconds = parseWatchInterval(strings.interval);

  if (booleans.watch && booleans.json) {
    throw new UsageError(
      "Cannot use both -watch and -json options.\n\n" +
        "  -watch  Continuously redraw the worktree list until you quit\n" +
        "  -json   Print a single machine-readable snapshot\n\n" +
        "These options are mutually exclusive. Use only one.",
    );
  }

  if (booleans.watch && !isTty()) {
    throw new UsageError(
      "-watch requires an interactive terminal.\n\n" +
        "Standard input or output is not a TTY (piped or redirected), so the live view cannot be drawn\n" +
        "and key presses cannot be read.\n\n" +
        "Use `claude-worktree list` for a one-shot snapshot, or `claude-worktree list -json` when capturing output.",
    );
  }

  return {
    json: booleans.json,
    quiet: booleans.quiet,
    verbose: booleans.verbose,
    noStatus: booleans.noStatus,
    fetch: booleans.fetch,
    watch: booleans.watch,
    intervalSeconds,
  };
}

const KNOWN_COMMANDS = ["list", "clean", "resume"] as const;

/** Commands come first so they win ties against the global flags. */
const TOP_LEVEL_CANDIDATES = [...KNOWN_COMMANDS, "-help", "-version"];

/**
 * Builds a "did you mean ...?" hint for a first argument that looks like a
 * mistyped command or global flag. Returns an empty string when nothing is close.
 */
function topLevelHint(name: string): string {
  const match = findClosestCommand(name, TOP_LEVEL_CANDIDATES);
  if (!match) {
    return "";
  }
  return match.startsWith("-") ? `\n\nDid you mean "${match}"?` : `\n\nDid you mean the "${match}" command?`;
}

/**
 * Help flags accepted everywhere `-help` is accepted. `--help` is one of the two
 * conventional double-dash exceptions (the other, `--version`, is handled in
 * parseArgs); other options keep their single-dash-only spelling.
 */
const HELP_FLAGS = new Set(["-h", "-help", "--help"]);

function hasHelpFlag(subArgs: string[]): boolean {
  return subArgs.some((arg) => HELP_FLAGS.has(arg));
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
      throw new UsageError("_run-in-pane requires exactly one payload file path argument");
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
    throw new UsageError(
      `Missing prompt for branch "${args[0]}".\n\n` +
        `Usage:\n  claude-worktree ${args[0]} '<prompt>'\n  claude-worktree ${args[0]} -plan <file-path>` +
        topLevelHint(args[0]),
    );
  }

  try {
    return { type: "create", args: parseCreateArgs(args) };
  } catch (error) {
    // A typo in the command name lands here as a create-command error
    // (unknown option, invalid branch name, ...) — point at the command instead.
    if (error instanceof UsageError) {
      const hint = topLevelHint(args[0]);
      if (hint) {
        throw new UsageError(`${error.message}${hint}`);
      }
    }
    throw error;
  }
}

export async function run(command: Command): Promise<void> {
  const quiet = "args" in command && command.args && "quiet" in command.args && command.args.quiet;
  if (quiet) {
    setLogger(createQuietLogger());
    setQuietMode(true);
  }

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
      logInfo(getVersion());
      break;
    case "create":
      await runCreate(command.args);
      break;
    case "resume":
      await runResume(command.args);
      break;
    case "list":
      if (command.args.watch) {
        await executeListWatch(command.args);
      } else {
        await executeList(command.args);
      }
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
