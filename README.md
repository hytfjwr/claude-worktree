# claude-worktree

A CLI tool for parallel development using WezTerm + git worktree + Claude Code. It creates a git worktree in a new WezTerm pane and automatically launches Claude Code.

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

- `--plan <file>` - Read prompt from a file (cannot be used with inline prompt)
- `-h, --help` - Show help

### Clean Options

- `-f, --force` - Skip confirmation prompt
- `-a, --all` - Show all worktrees for manual selection
- `-n, --dry-run` - Preview targets without deleting

### Examples

```bash
# Create a worktree for feature branch and start Claude Code
claude-worktree feature/auth 'Implement Auth' 'Implement authentication feature'

# Without initial prompt
claude-worktree fix/bug-123 'Fix login bug'

# Read prompt from a plan file
claude-worktree feature/api 'API Implementation' --plan ./plan.md

# Clean up unnecessary worktrees
claude-worktree clean

# Preview worktrees to be deleted
claude-worktree clean --dry-run

# Select from all worktrees manually
claude-worktree clean --all
```

## How It Works

1. Parses arguments (branch name, task name, optional prompt or plan file)
2. Gets the git repository root and current branch
3. Splits a new pane to the right in WezTerm
4. In the new pane: creates worktree → launches Claude Code

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
  git.ts               # Git operations (repo info, worktree path generation)
  wezterm.ts           # WezTerm pane operations (split, send text)
  claude.ts            # Claude Code command generation
  clean.ts             # Worktree cleanup orchestration
  prompt.ts            # Interactive user prompts
  index.ts             # Public API (barrel exports)
```

## License

MIT
