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

```bash
claude-worktree <branch-name> <task-name> [prompt]
```

### Examples

```bash
# Create a worktree for feature branch and start Claude Code
claude-worktree feature/auth 'Implement Auth' 'Implement authentication feature'

# Without initial prompt
claude-worktree fix/bug-123 'Fix login bug'
```

## How It Works

1. Parses arguments (branch name, task name, optional prompt)
2. Gets the git repository root and current branch
3. Splits a new pane to the right in WezTerm
4. In the new pane: creates worktree → installs dependencies → launches Claude Code

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
  index.ts             # Public API (barrel exports)
```

## License

MIT
