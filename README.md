# claude-worktree

[![npm version](https://img.shields.io/npm/v/@hytfjwr/claude-worktree.svg)](https://www.npmjs.com/package/@hytfjwr/claude-worktree)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A CLI tool that creates a git worktree and launches [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with a prompt. With the `-pane` option, it opens in a new [WezTerm](https://wezfurlong.org/wezterm/) pane, enabling parallel development across multiple worktrees.

## Requirements

- [Node.js](https://nodejs.org/) (v22+)
- [Git](https://git-scm.com/)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [WezTerm](https://wezfurlong.org/wezterm/) (optional, required only for `-pane`)
- [GitHub CLI](https://cli.github.com/) (optional, enables PR info display in `clean`)

## Installation

```bash
npm install -g @hytfjwr/claude-worktree
```

Or run directly with npx:

```bash
npx @hytfjwr/claude-worktree feature/auth 'Implement authentication feature'
```

## Quick Start

```bash
# Create a worktree and start Claude Code
claude-worktree feature/auth 'Implement authentication feature'

# Open in a new WezTerm pane for parallel development
claude-worktree feature/auth 'Implement authentication feature' -pane

# Resume a session in an existing worktree
claude-worktree resume feature/auth
```

## Usage

### Create Command

```bash
claude-worktree <branch-name> <prompt>
claude-worktree <branch-name> -plan <file-path>
```

### List Command

```bash
claude-worktree list [options]
```

### Resume Command

```bash
claude-worktree resume [<branch-name>] [<prompt>]
```

### Clean Command

```bash
claude-worktree clean [options]
```

### Help / Version

```bash
claude-worktree -h
claude-worktree -help
claude-worktree -version
claude-worktree --version
```

### Options

- `-p, -pane` - Open in a new WezTerm pane (default: run in current terminal)
- `-plan <file>` - Read prompt from a file (cannot be used with inline prompt)
- `-b, -base <branch>` - Specify base branch (default: current branch)
- `-d, -danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `-merge` - Auto-merge into base branch and cleanup after task completion
- `-draft` - Auto-create Draft PR after task completion (cannot be used with -merge)
- `-pull` - Fetch latest base branch from remote before creating worktree
- `-n, -dry-run` - Preview what would be created without executing
- `-v, -verbose` - Show hook execution logs
- `-h, -help` - Show help
- `-version, --version` - Show version number

### List Options

- `-j, -json` - Output as JSON
- `-s, -status` - Show Claude session status (Running/Done)
- `-v, -verbose` - Show full paths and details

When `resume` or `clean -all` is run without a branch name, an interactive TUI selector is displayed:

- **↑/↓** or **j/k** — navigate items
- **Enter** — confirm selection
- **Space** — toggle item (multi-select only)
- **a** — select/deselect all (multi-select only)
- **q/Esc** — cancel

When stdin is not a TTY (e.g., piped input), the selector falls back to a numbered-list prompt.

### Resume Options

- `-p, -pane` - Open in a new WezTerm pane (default: run in current terminal)
- `-d, -danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `-v, -verbose` - Show verbose output

### Clean Options

- `-f, -force` - Skip confirmation prompt
- `-a, -all` - Show all worktrees for manual selection
- `-n, -dry-run` - Preview targets without deleting
- `-v, -verbose` - Show hook execution logs

### Examples

```bash
# Create a worktree and start Claude Code in current terminal
claude-worktree feature/auth 'Implement authentication feature'

# Open in a new WezTerm pane
claude-worktree feature/auth 'Implement authentication feature' -pane

# Short form
claude-worktree fix/bug-123 'Fix login bug' -p

# Read prompt from a plan file
claude-worktree feature/api -plan ./plan.md

# Create worktree from specific base branch
claude-worktree feature/auth 'Implement authentication feature' -base develop

# Skip workspace warning
claude-worktree feature/auth 'Implement authentication feature' -danger

# Auto-merge into base branch after task completion
claude-worktree feature/auth 'Implement authentication feature' -merge

# Auto-create Draft PR after task completion
claude-worktree feature/auth 'Implement authentication feature' -draft

# Draft PR with specific base branch
claude-worktree feature/auth 'Implement authentication feature' -draft -base main

# Fetch latest remote before creating worktree
claude-worktree feature/auth 'Implement authentication feature' -pull

# Fetch latest remote with specific base branch
claude-worktree feature/auth 'Implement authentication feature' -pull -base main

# Resume a Claude session in an existing worktree
claude-worktree resume feature/auth

# Resume with an additional prompt
claude-worktree resume feature/auth 'Continue the authentication implementation'

# Interactive worktree selection (arrow-key TUI)
claude-worktree resume

# List worktrees with status
claude-worktree list

# Show Claude session status (Running/Done)
claude-worktree list -status

# List worktrees as JSON
claude-worktree list -json

# Clean up unnecessary worktrees
claude-worktree clean

# Preview worktrees to be deleted
claude-worktree clean -dry-run

# Select from all worktrees manually (arrow-key TUI)
claude-worktree clean -all

# Preview what would be created (dry-run)
claude-worktree feature/auth 'Implement authentication feature' -dry-run
```

### JSON Output Schema

When using `claude-worktree list -json`, the output follows this schema:

```json
{
  "worktrees": [
    {
      "path": "/absolute/path/to/worktree",
      "branch": "feature/auth",
      "isMain": false,
      "isLocked": false,
      "isDirty": false,
      "status": "Active",
      "commit": {
        "hash": "abc1234",
        "message": "Commit message",
        "date": "2025-01-15T10:00:00.000Z"
      },
      "aheadBehind": { "ahead": 2, "behind": 0 },
      "session": {
        "status": "running",
        "elapsedMs": 900000,
        "mode": "pane",
        "paneId": 3
      }
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Absolute path to the worktree directory |
| `branch` | `string \| null` | Branch name, or `null` for detached HEAD |
| `isMain` | `boolean` | Whether this is the main worktree |
| `isLocked` | `boolean` | Whether the worktree is locked |
| `isDirty` | `boolean` | Whether the worktree has uncommitted changes |
| `status` | `string` | One of: `"Main"`, `"Locked"`, `"Merged"`, `"Dirty"`, `"Active"` |
| `commit` | `object \| null` | Latest commit info (`hash`, `message`, `date`) |
| `aheadBehind` | `object \| null` | `{ ahead: number, behind: number }` relative to main branch |
| `session` | `object \| undefined` | Claude session info (only with `-status` flag) |
| `session.status` | `string` | `"running"` or `"done"` |
| `session.elapsedMs` | `number` | Milliseconds since session started |
| `session.mode` | `string` | `"pane"` or `"terminal"` |
| `session.paneId` | `number \| undefined` | WezTerm pane ID (pane mode only) |

## Hook Configuration

You can define project-specific hooks in `.claude-worktree.json` at the repository root:

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

### Worktree Limit

- `maxWorktrees` — Maximum number of concurrent worktrees (excludes main). If set, blocks creation when the limit is reached.

### Template Variables

- `{path}` — worktree path
- `{slot}` — auto-assigned slot number (1-9) based on port availability (8881-8889). Slot assignments are persisted to `~/.cache/claude-worktree/slots.json` so that `preClean`/`postClean` hooks can reference the same slot that was assigned during `postCreate`.

### Hooks

- **postCreate** — Runs after worktree creation (e.g., start Docker containers). If the hook fails, the worktree is automatically rolled back.
- **preClean** — Runs before worktree deletion (e.g., stop Docker containers). If the hook fails, deletion continues with a warning.
- **postClean** — Runs after worktree and branch deletion (e.g., Docker volume removal, DNS cleanup). If the hook fails, the operation continues with a warning.

### Timeout

- `hookTimeout` — Global default timeout in seconds (default: `600`)
- `postCreateTimeout` — Override timeout for postCreate hook
- `preCleanTimeout` — Override timeout for preClean hook
- `postCleanTimeout` — Override timeout for postClean hook

Priority: hook-specific value > `hookTimeout` > default (600s)

### Environment Variables

- `CLAUDE_WORKTREE_CACHE_DIR` — Override the slot cache directory (default: `~/.cache/claude-worktree`)
- `NO_COLOR` — Disable colored output ([no-color.org](https://no-color.org/)). Colors are also automatically disabled when stdout is not a TTY (e.g., piped output).

## License

[MIT](LICENSE)
