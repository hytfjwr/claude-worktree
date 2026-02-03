# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool for parallel development using WezTerm + git worktree + Claude Code. It creates a git worktree in a new WezTerm pane and automatically launches Claude Code.

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
claude-worktree fix/bug-123 'Fix login bug'
claude-worktree feature/api 'API Implementation' --plan ./plan.md
claude-worktree feature/auth 'Auth実装' '認証機能を実装' --base develop
claude-worktree clean
claude-worktree clean --dry-run
```

### Options

- `--plan <file>` - Read prompt from a file (cannot be used with inline prompt)
- `--base <branch>` - ベースブランチを指定（デフォルト: 現在のブランチ）
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
  git.ts               # Git operations (repo info, worktree path generation)
  wezterm.ts           # WezTerm pane operations (split, send text)
  claude.ts            # Claude Code command generation
  clean.ts             # Worktree cleanup orchestration
  prompt.ts            # Interactive user prompts
  index.ts             # Public API (barrel exports)

  # Test files (co-located)
  claude.test.ts       # Tests for claude.ts
  git.test.ts          # Tests for git.ts
  cli.test.ts          # Tests for cli.ts
  wezterm.test.ts      # Tests for wezterm.ts
  clean.test.ts        # Tests for clean.ts
```

**Processing Flow:**
1. Parse arguments (branch name, task name, prompt or plan file)
2. Get the git repository root and current branch
3. Split a new pane to the right in WezTerm
4. In the new pane: create worktree → launch Claude Code

**External Tool Dependencies:** bun, git, wezterm CLI, claude CLI

## Testing

Uses Bun test. Test files are co-located with source files in the same directory.

- **Pure functions**: Tested without mocks (buildClaudeCommand, getWorktreePath, etc.)
- **Shell commands**: Tested using the actual git repository
- **DI (Dependency Injection)**: clean.ts uses CleanDependencies type for mockability
