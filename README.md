# claude-worktree

A CLI tool for parallel development using WezTerm + git worktree + Claude Code. It creates a git worktree and launches Claude Code. With the `--pane` option, it opens in a new WezTerm pane for parallel development.

## Requirements

- [Bun](https://bun.sh/)
- [Git](https://git-scm.com/)
- [Claude Code](https://claude.ai/code)
- [WezTerm](https://wezfurlong.org/wezterm/) (optional, required only for `--pane`)

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
claude-worktree <branch-name> <prompt>
claude-worktree <branch-name> --plan <file-path>
```

### List Command

```bash
claude-worktree list [options]
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
- `--danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `--merge` - Auto-merge into base branch and cleanup after task completion
- `--draft` - Auto-create Draft PR after task completion (cannot be used with --merge)
- `-v, --verbose` - Show hook execution logs
- `-h, --help` - Show help

### List Options

- `--json` - Output as JSON
- `-v, --verbose` - Show full paths and details

### Clean Options

- `-f, --force` - Skip confirmation prompt
- `-a, --all` - Show all worktrees for manual selection
- `-n, --dry-run` - Preview targets without deleting
- `-v, --verbose` - Show hook execution logs

### Examples

```bash
# Create a worktree and start Claude Code in current terminal
claude-worktree feature/auth 'Implement authentication feature'

# Open in a new WezTerm pane
claude-worktree feature/auth 'Implement authentication feature' --pane

# Short form
claude-worktree fix/bug-123 'Fix login bug' -p

# Read prompt from a plan file
claude-worktree feature/api --plan ./plan.md

# Create worktree from specific base branch
claude-worktree feature/auth 'Implement authentication feature' --base develop

# Skip workspace warning
claude-worktree feature/auth 'Implement authentication feature' --danger

# Auto-merge into base branch after task completion
claude-worktree feature/auth 'Implement authentication feature' --merge

# Auto-create Draft PR after task completion
claude-worktree feature/auth 'Implement authentication feature' --draft

# Draft PR with specific base branch
claude-worktree feature/auth 'Implement authentication feature' --draft --base main

# List worktrees with status
claude-worktree list

# List worktrees as JSON
claude-worktree list --json

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

1. Parses arguments (branch name, prompt or plan file)
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

## License

MIT
