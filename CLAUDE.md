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
make typecheck   # or pnpm run typecheck

# Lint (Biome)
pnpm run lint

# Test
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage

# Check dependencies (node, git, wezterm, claude, gh)
make check
```

## Usage

```bash
# Create command
claude-worktree <branch-name> <prompt>
claude-worktree <branch-name> -plan <file-path>

# Resume command
claude-worktree resume <branch-name>            # Resume a Claude session
claude-worktree resume <branch-name> '<prompt>'  # Resume with additional prompt
claude-worktree resume                           # Interactive worktree selection

# List command
claude-worktree list [options]

# Clean command
claude-worktree clean [options]

# Help / Version
claude-worktree -h / -help
claude-worktree -version / --version

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
claude-worktree feature/auth 'Implement authentication feature' -pr
claude-worktree feature/auth 'Implement authentication feature' -pr -base main
claude-worktree feature/auth 'Implement authentication feature' -pull
claude-worktree feature/auth 'Implement authentication feature' -pull -base main
claude-worktree feature/auth 'Implement authentication feature' -dry-run
claude-worktree resume feature/auth
claude-worktree resume feature/auth 'Continue implementation'
claude-worktree resume
claude-worktree list
claude-worktree list -fetch
claude-worktree list -json
claude-worktree list -no-status
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
- `-draft` - Auto-create Draft PR after task completion (cannot be used with -merge or -pr)
- `-pr` - Auto-create PR after task completion (cannot be used with -merge or -draft)
- `-pull` - Fetch latest base branch from remote before creating worktree
- `-n, -dry-run` - Preview what would be created without executing
- `-v, -verbose` - Show hook execution logs
- `-h, -help` - Show help

### Resume Options

- `-p, -pane` - Open in a new WezTerm pane (default: run in current terminal)
- `-d, -danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `-v, -verbose` - Show verbose output

### List Options

- `-j, -json` - Output as JSON
- `-no-status` - Hide Claude session status (shown by default)
- `-fetch` - Fetch from remote before listing (default: local only)
- `-v, -verbose` - Show full paths and details

### Clean Options

- `-f, -force` - Skip confirmation prompt
- `-a, -all` - Show all worktrees for manual selection
- `-n, -dry-run` - Preview targets without deleting
- `-v, -verbose` - Show hook execution logs

## Architecture

A TypeScript CLI tool running on Node.js.

```
bin/
  claude-worktree.ts   # Entry point
src/
  core/                # Core domain logic
    cache.ts           # File lock and JSON cache utilities
    cache.test.ts
    config.ts          # Project config (.claude-worktree.json) & hook execution
    config.test.ts
    errors.ts          # Custom error types and type guards
    errors.test.ts
    exec.ts            # Shell command execution (child_process wrapper)
    exec.test.ts
    git.ts             # Git operations (repo info, worktree creation)
    git.test.ts
    session.ts         # Session metadata (save/read/complete/delete) & status detection
    session.test.ts
    slot.ts            # Port-scan based slot auto-assignment & slot cache
    slot.test.ts
    spawn.ts           # Interactive process spawning with signal forwarding
    spawn.test.ts
  commands/            # Command implementations
    clean.ts           # Worktree cleanup orchestration
    clean.test.ts
    create.ts          # Create command orchestration
    create.test.ts
    hooks.ts           # Shared hook execution with spinner feedback
    hooks.test.ts
    list.ts            # Worktree listing with rich display
    list.test.ts
    resume.ts          # Resume command orchestration
    resume.test.ts
    rollback.ts        # Worktree rollback logic
    rollback.test.ts
    run-in-pane.ts     # Pane mode execution orchestration
    run-in-pane.test.ts
  external/            # External tool integrations
    claude.ts          # Claude Code command generation
    claude.test.ts
    wezterm.ts         # WezTerm pane operations (split, send text)
    wezterm.test.ts
  ui/                  # Terminal UI utilities
    color.ts           # Terminal color utilities (NO_COLOR support)
    color.test.ts
    icons.ts           # Terminal icon/symbol utilities
    icons.test.ts
    logger.ts          # Logging utilities
    logger.test.ts
    prompt.ts          # Interactive user prompts
    select.ts          # Interactive selection (single/multi, TTY/non-TTY)
    select.test.ts
    spinner.ts         # Terminal spinner with shimmer effect
    spinner.test.ts
  cli.ts               # Argument parsing & routing
  cli.test.ts
  options.ts           # CLI option extraction utility
  options.test.ts
  version.ts           # Package version reader
  version.test.ts
  types.ts             # Shared type definitions
  index.ts             # Public API (barrel exports)
```

**Processing Flow:**
1. Parse arguments (branch name, prompt or plan file)
2. Get the git repository root and current branch
3. Load project config from `.claude-worktree.json` (if exists)
4. Create worktree directly via `git worktree add`
5. Run `postCreate` hook (if configured) — rollback worktree on failure
6. If `-pane`: Split a new pane to the right in WezTerm → cd into worktree → launch Claude Code → save session metadata
7. Otherwise: cd into worktree → launch Claude Code in current terminal → mark session as completed on exit

**Hook Configuration (`.claude-worktree.json`):**
```json
{
  "maxWorktrees": 5,
  "hookTimeout": 600,
  "postCreate": "cd {path} && docker-compose -p app-{slot} up -d",
  "postCreateTimeout": 300,
  "preClean": "cd {path} && docker-compose down",
  "preCleanTimeout": 120,
  "postClean": "docker volume rm app-{path}-data || true",
  "postCleanTimeout": 60
}
```
- `maxWorktrees` — maximum number of concurrent worktrees (excludes main). If set, blocks creation when the limit is reached.
- `{path}` — worktree path
- `{slot}` — auto-assigned slot (1-9) based on port availability (8881-8889), persisted to `~/.cache/claude-worktree/slots.json`

**Session Tracking (`~/.cache/claude-worktree/sessions.json`):**
- Worktree 作成時にセッションメタデータ (pane ID, mode, startedAt) を保存
- `list` で各 worktree の Claude セッション状態 (Running/Done) をデフォルト表示 (`-no-status` で無効化)
- pane モード: WezTerm pane の存在で Running/Done を判定
- terminal モード: プロセス終了時に `completedAt` を設定して Done 判定
- `clean` 実行時にセッションデータも自動削除
- `hookTimeout` — global default timeout in seconds (default: 600)
- `postCreateTimeout` / `preCleanTimeout` / `postCleanTimeout` — per-hook timeout override
- Priority: hook-specific value > `hookTimeout` > default (600s)

**Environment Variables:**
- `CLAUDE_WORKTREE_CACHE_DIR` — override the slot cache directory (default: `~/.cache/claude-worktree`)

**External Tool Dependencies:** node, git, wezterm CLI, claude CLI, gh CLI (optional)

## Testing

Uses Vitest. Test files are co-located with source files in the same directory.

- **Pure functions**: Tested without mocks (buildClaudeCommand, getWorktreePath, etc.)
- **Shell commands**: Tested using the actual git repository
- **DI (Dependency Injection)**: clean.ts and list.ts use DI types (CleanDeps, ListDeps) for mockability
