# claude-worktree

A CLI tool for parallel development using WezTerm + git worktree + Claude Code. It creates a git worktree and launches Claude Code. With the `--pane` option, it opens in a new WezTerm pane for parallel development.

## Requirements

- [Bun](https://bun.sh/)
- [Git](https://git-scm.com/)
- [WezTerm](https://wezfurlong.org/wezterm/)
- [Claude Code](https://claude.ai/code)

## Installation

```bash
make install
```

Or link manually:

```bash
bun link
```

## Usage

### Create Command

```bash
claude-worktree <branch-name> <task-name> [prompt]
claude-worktree <branch-name> <task-name> --plan <file-path>
```

### Clean Command

```bash
claude-worktree clean [options]
```

### Help

```bash
claude-worktree -h
claude-worktree --help
```

### Options

- `-p, --pane` - Open in a new WezTerm pane (default: run in current terminal)
- `--plan <file>` - Read prompt from a file (cannot be used with inline prompt)
- `--base <branch>` - Base branch for worktree (default: current branch)
- `-h, --help` - Show help

### Clean Options

- `-f, --force` - Skip confirmation prompt
- `-a, --all` - Show all worktrees for manual selection
- `-n, --dry-run` - Preview targets without deleting

### Examples

```bash
# Create a worktree and start Claude Code in current terminal
claude-worktree feature/auth 'Implement Auth' 'Implement authentication feature'

# Open in a new WezTerm pane
claude-worktree feature/auth 'Implement Auth' 'Implement authentication feature' --pane

# Short form
claude-worktree fix/bug-123 'Fix login bug' -p

# Read prompt from a plan file
claude-worktree feature/api 'API Implementation' --plan ./plan.md

# Create worktree from specific base branch
claude-worktree feature/auth 'Implement Auth' 'Implement auth' --base develop

# Clean up unnecessary worktrees
claude-worktree clean

# Preview worktrees to be deleted
claude-worktree clean --dry-run

# Select from all worktrees manually
claude-worktree clean --all
```

## Hook Configuration

You can define project-specific hooks in `.claude-worktree.json` at the repository root:

```json
{
  "postCreate": "cd {path} && docker-compose -p app-{slot} up -d",
  "preClean": "cd {path} && docker-compose down"
}
```

### Template Variables

- `{path}` — worktree path
- `{slot}` — auto-assigned slot number (1-9) based on port availability (8881-8889)

### Hooks

- **postCreate** — Runs after worktree creation (e.g., start Docker containers). If the hook fails, the worktree is automatically rolled back.
- **preClean** — Runs before worktree deletion (e.g., stop Docker containers). If the hook fails, deletion continues with a warning.

## How It Works

1. Parses arguments (branch name, task name, optional prompt or plan file)
2. Gets the git repository root and current branch
3. Loads project config from `.claude-worktree.json` (if exists)
4. Creates worktree directly via `git worktree add`
5. Runs `postCreate` hook (if configured)
6. If `--pane`: Splits a new pane to the right in WezTerm → cd into worktree → launches Claude Code
7. Otherwise: cd into worktree → launches Claude Code in current terminal

## Development

```bash
# Run in development mode
make dev

# Type check
make typecheck

# Lint (Biome)
bun run lint

# Check dependencies (bun, git, wezterm, claude)
make check
```

## Architecture

A TypeScript CLI tool running on the Bun runtime with zero external npm dependencies (uses only Bun built-in APIs).

```
bin/
  claude-worktree.ts   # Entry point
src/
  cli.ts               # Argument parsing & orchestration
  git.ts               # Git operations (repo info, worktree creation)
  wezterm.ts           # WezTerm pane operations (split, send text)
  claude.ts            # Claude Code command generation
  clean.ts             # Worktree cleanup orchestration
  config.ts            # Project config (.claude-worktree.json) & hook execution
  slot.ts              # Port-scan based slot auto-assignment
  prompt.ts            # Interactive user prompts
  index.ts             # Public API (barrel exports)
```

## License

MIT
