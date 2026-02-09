# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool for parallel development using WezTerm + git worktree + Claude Code. It creates a git worktree and launches Claude Code. With the `-pane` option, it opens in a new WezTerm pane for parallel development.

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
claude-worktree <branch-name> <prompt>
claude-worktree <branch-name> -plan <file-path>

# List command
claude-worktree list [options]

# Clean command
claude-worktree clean [options]

# Help
claude-worktree -h / -help

# Examples
claude-worktree feature/auth 'Implement authentication feature'
claude-worktree feature/auth 'Implement authentication feature' -pane
claude-worktree fix/bug-123 'Fix login bug' -p
claude-worktree feature/api -plan ./plan.md
claude-worktree feature/auth 'Implement authentication feature' -base develop
claude-worktree feature/auth 'Implement authentication feature' -danger
claude-worktree feature/auth 'Implement authentication feature' -merge
claude-worktree feature/auth 'Implement authentication feature' -draft
claude-worktree feature/auth 'Implement authentication feature' -draft -base main
claude-worktree list
claude-worktree list -json
claude-worktree list -v
claude-worktree clean
claude-worktree clean -dry-run
```

### Options

- `-p, -pane` - Open in a new WezTerm pane (default: run in current terminal)
- `-plan <file>` - Read prompt from a file (cannot be used with inline prompt)
- `-b, -base <branch>` - Specify base branch (default: current branch)
- `-d, -danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `-m, -merge` - Auto-merge into base branch and cleanup after task completion
- `-draft` - Auto-create Draft PR after task completion (cannot be used with -merge)
- `-v, -verbose` - Show hook execution logs
- `-h, -help` - Show help

### List Options

- `-j, -json` - Output as JSON
- `-v, -verbose` - Show full paths and details

### Clean Options

- `-f, -force` - Skip confirmation prompt
- `-a, -all` - Show all worktrees for manual selection
- `-n, -dry-run` - Preview targets without deleting
- `-v, -verbose` - Show hook execution logs

## Architecture

A TypeScript CLI tool running on the Bun runtime with zero external npm dependencies (uses only Bun built-in APIs).

```
bin/
  claude-worktree.ts   # Entry point
src/
  core/                # Core domain logic
    git.ts             # Git operations (repo info, worktree creation)
    git.test.ts
    config.ts          # Project config (.claude-worktree.json) & hook execution
    config.test.ts
    slot.ts            # Port-scan based slot auto-assignment
  commands/            # Command implementations
    create.ts          # Create command orchestration
    list.ts            # Worktree listing with rich display
    list.test.ts
    clean.ts           # Worktree cleanup orchestration
    clean.test.ts
  external/            # External tool integrations
    claude.ts          # Claude Code command generation
    claude.test.ts
    wezterm.ts         # WezTerm pane operations (split, send text)
    wezterm.test.ts
  ui/                  # Terminal UI utilities
    spinner.ts         # Terminal spinner with shimmer effect
    spinner.test.ts
    prompt.ts          # Interactive user prompts
  cli.ts               # Argument parsing & routing
  cli.test.ts
  options.ts           # CLI option extraction utility
  options.test.ts
  types.ts             # Shared type definitions
  index.ts             # Public API (barrel exports)
```

**Processing Flow:**
1. Parse arguments (branch name, prompt or plan file)
2. Get the git repository root and current branch
3. Load project config from `.claude-worktree.json` (if exists)
4. Create worktree directly via `git worktree add`
5. Run `postCreate` hook (if configured) — rollback worktree on failure
6. If `-pane`: Split a new pane to the right in WezTerm → cd into worktree → launch Claude Code
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
- **DI (Dependency Injection)**: clean.ts and list.ts use DI types (CleanDeps, ListDeps) for mockability
