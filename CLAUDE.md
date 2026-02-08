# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool for parallel development using WezTerm + git worktree + Claude Code. It creates a git worktree and launches Claude Code. With the `--pane` option, it opens in a new WezTerm pane for parallel development.

## Commands

```bash
# Install
make install

# Run in development mode
make dev

# Type check
make typecheck   # or bun run typecheck

# Lint (Biome)
bun run lint

# Test
bun test              # Run all tests
bun test --watch      # Watch mode
bun test --coverage   # With coverage

# Check dependencies (bun, git, wezterm, claude)
make check
```

## Usage

```bash
# Create command
claude-worktree <branch-name> <task-name> [prompt]
claude-worktree <branch-name> <task-name> --plan <file-path>

# Clean command
claude-worktree clean [options]

# Help
claude-worktree -h / --help

# Examples
claude-worktree feature/auth 'Implement Auth' 'Implement authentication feature'
claude-worktree feature/auth 'Implement Auth' 'Implement authentication feature' --pane
claude-worktree fix/bug-123 'Fix login bug' -p
claude-worktree feature/api 'API Implementation' --plan ./plan.md
claude-worktree feature/auth 'Implement Auth' 'Implement authentication feature' --base develop
claude-worktree clean
claude-worktree clean --dry-run
```

### Options

- `-p, --pane` - Open in a new WezTerm pane (default: run in current terminal)
- `--plan <file>` - Read prompt from a file (cannot be used with inline prompt)
- `--base <branch>` - Specify base branch (default: current branch)
- `--danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `-h, --help` - Show help

### Clean Options

- `-f, --force` - Skip confirmation prompt
- `-a, --all` - Show all worktrees for manual selection
- `-n, --dry-run` - Preview targets without deleting

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

  # Test files (co-located)
  claude.test.ts       # Tests for claude.ts
  git.test.ts          # Tests for git.ts
  cli.test.ts          # Tests for cli.ts
  wezterm.test.ts      # Tests for wezterm.ts
  clean.test.ts        # Tests for clean.ts
  config.test.ts       # Tests for config.ts
  slot.test.ts         # Tests for slot.ts
```

**Processing Flow:**
1. Parse arguments (branch name, task name, prompt or plan file)
2. Get the git repository root and current branch
3. Load project config from `.claude-worktree.json` (if exists)
4. Create worktree directly via `git worktree add`
5. Run `postCreate` hook (if configured) — rollback worktree on failure
6. If `--pane`: Split a new pane to the right in WezTerm → cd into worktree → launch Claude Code
7. Otherwise: cd into worktree → launch Claude Code in current terminal

**Hook Configuration (`.claude-worktree.json`):**
```json
{
  "postCreate": "cd {path} && docker-compose -p app-{slot} up -d",
  "preClean": "cd {path} && docker-compose down"
}
```
- `{path}` — worktree path
- `{slot}` — auto-assigned slot (1-9) based on port availability (8881-8889)

**External Tool Dependencies:** bun, git, wezterm CLI, claude CLI

## Testing

Uses Bun test. Test files are co-located with source files in the same directory.

- **Pure functions**: Tested without mocks (buildClaudeCommand, getWorktreePath, etc.)
- **Shell commands**: Tested using the actual git repository
- **DI (Dependency Injection)**: clean.ts uses CleanDependencies type for mockability
