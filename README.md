# claude-worktree

[![npm version](https://img.shields.io/npm/v/@hytfjwr/claude-worktree.svg)](https://www.npmjs.com/package/@hytfjwr/claude-worktree)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A CLI tool that creates a git worktree and launches [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with a prompt. With the `-pane` option, it opens in a new [WezTerm](https://wezfurlong.org/wezterm/) or [tmux](https://github.com/tmux/tmux) pane, or a new [herdr](https://herdr.dev) workspace, enabling parallel development across multiple worktrees.

## Requirements

- [Node.js](https://nodejs.org/) (v22+)
- [Git](https://git-scm.com/)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [WezTerm](https://wezfurlong.org/wezterm/), [tmux](https://github.com/tmux/tmux) or [herdr](https://herdr.dev) v0.7.0+ (optional, required only for `-pane`)
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

# Open in a new pane for parallel development (WezTerm, tmux or herdr)
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

### Typo Suggestions

Mistyped options, commands and branch names are matched against the known ones by
Levenshtein distance, and the closest candidate is suggested:

```console
$ claude-worktree list -jsom
Unknown option for list command: "-jsom" (did you mean "-json"?)

$ claude-worktree lst
Missing prompt for branch "lst".
...
Did you mean the "list" command?

$ claude-worktree resume feature/aut
Worktree not found for branch: feature/aut

Did you mean "feature/auth"?
```

### Options

- `-p, -pane` - Open in a new pane (requires WezTerm, tmux or herdr; default: run in current terminal)
- `-plan <file>` - Read prompt from a file (cannot be used with inline prompt)
- `-b, -base <branch>` - Specify base branch (default: current branch)
- `-d, -danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `-merge` - Auto-merge into base branch and cleanup after task completion
- `-draft` - Auto-create Draft PR after task completion (cannot be used with -merge or -pr)
- `-pr` - Auto-create PR after task completion (cannot be used with -merge or -draft)
- `-pull` - Fetch latest base branch from remote before creating worktree
- `-n, -dry-run` - Preview what would be created without executing
- `-j, -json` - Print the result as one line of JSON (requires `-pane` or `-dry-run`)
- `-v, -verbose` - Show hook execution logs
- `-h, -help` - Show help
- `-version, --version` - Show version number

### List Options

- `-j, -json` - Output as JSON
- `-no-status` - Hide Claude session status (shown by default)
- `-fetch` - Fetch from remote before listing (default: local only; with `-watch`, only the first refresh fetches)
- `-w, -watch` - Redraw the list on an interval until you quit (requires a TTY; cannot be used with `-json`)
- `-interval <seconds>` - Refresh interval for `-watch` (default: 2, min: 1, max: 60)
- `-q, -quiet` - Suppress informational output (errors only)
- `-v, -verbose` - Show full paths and details

In `-watch` mode the list is redrawn in the terminal's alternate screen buffer, so it never pollutes the scrollback:

- **r** — refresh immediately
- **q** / **Esc** / **Ctrl+C** — quit

`-fetch` is applied only to the first refresh, so a long watch session does not keep hitting the remote.

When `resume` or `clean -all` is run without a branch name, an interactive TUI selector is displayed:

- **↑/↓** or **j/k** — navigate items
- **Enter** — confirm selection
- **Space** — toggle item (multi-select only)
- **a** — select/deselect all (multi-select only)
- **q/Esc** — cancel

When stdin is not a TTY (e.g., piped input), the selector falls back to a numbered-list prompt.

### Resume Options

- `-p, -pane` - Open in a new pane (requires WezTerm, tmux or herdr; default: run in current terminal)
- `-d, -danger` - Skip workspace warning (uses --dangerously-skip-permissions)
- `-j, -json` - Print the result as one line of JSON (requires `-pane` and a branch name)
- `-v, -verbose` - Show verbose output

### Clean Options

- `-f, -force` - Skip confirmation prompt
- `-a, -all` - Show all worktrees for manual selection
- `-n, -dry-run` - Preview targets without deleting
- `-v, -verbose` - Show hook execution logs

### Pane Backends

`-pane` opens the worktree in a new pane of the terminal multiplexer you are running in. The backend is detected from the environment, in this order:

1. **herdr** — when running inside a herdr pane (`HERDR_ENV=1`). Checked first because herdr panes inherit the `WEZTERM_PANE` / `TMUX` variables of the herdr server process.
2. **WezTerm** — when `WEZTERM_PANE` is set.
3. **tmux** — when `TMUX` is set.

Outside any of them, `-pane` still works if a herdr server is running (`herdr status server` reports `status: running`) or tmux is installed (a detached session is created). herdr is preferred over tmux.

Set `CLAUDE_WORKTREE_BACKEND=wezterm|tmux|herdr` to skip detection and force a backend. The command fails if the forced backend is not usable (for example, herdr without a running server).

#### herdr

With herdr, `-pane` creates a **new workspace** rather than splitting the current one. The workspace's working directory is the worktree, its label defaults to `<repo>/<branch>` (configurable via `herdr.label` in `.claude-worktree.json`), and focus stays on the current workspace. The command is sent once the workspace's shell reaches its prompt (up to 15s).

`list` shows herdr sessions as Running while the pane exists, and appends herdr's agent state (`[working]`, `[blocked]`, `[idle]`, `[done]`) when it is known. `clean` removes the worktree and its session metadata but leaves the herdr workspace open, matching the WezTerm/tmux behaviour.

### Examples

```bash
# Create a worktree and start Claude Code in current terminal
claude-worktree feature/auth 'Implement authentication feature'

# Open in a new pane (WezTerm, tmux or herdr)
claude-worktree feature/auth 'Implement authentication feature' -pane

# Open in a new pane and print the result as JSON (for scripts and agents)
claude-worktree feature/auth 'Implement authentication feature' -pane -json

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

# Auto-create PR after task completion
claude-worktree feature/auth 'Implement authentication feature' -pr

# PR with specific base branch
claude-worktree feature/auth 'Implement authentication feature' -pr -base main

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

# Hide Claude session status
claude-worktree list -no-status

# Live view: redraw the list every 2 seconds until you quit
claude-worktree list -watch

# Live view with a 5 second interval
claude-worktree list -watch -interval 5

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
| `session` | `object \| undefined` | Claude session info (omitted with `-no-status`) |
| `session.status` | `string` | `"running"`, `"done"`, or `"unknown"` (pane backend unavailable) |
| `session.elapsedMs` | `number` | Milliseconds since session started |
| `session.mode` | `string` | `"pane"` or `"terminal"` |
| `session.paneId` | `number \| string \| undefined` | Pane ID — WezTerm (number), tmux (string, e.g. `%0`) or herdr (string, e.g. `w1:p1`). Pane mode only. |
| `session.agentStatus` | `string \| undefined` | herdr only — agent state reported by herdr: `"idle"`, `"working"`, `"blocked"`, `"done"` or `"unknown"` |

### Create / Resume JSON Output

With `-pane -json` (or `-dry-run -json`), `claude-worktree <branch> <prompt>` and `claude-worktree resume <branch>` suppress their human-readable output and print a single JSON line on stdout. Confirmation prompts are not shown in this mode; if one would be required, the command fails instead.

```json
{
  "dryRun": false,
  "repoRoot": "/absolute/path/to/repo",
  "branch": "feature/auth",
  "baseBranch": "main",
  "worktreePath": "/absolute/path/to/repo-worktrees/feature-auth",
  "mode": "pane",
  "backend": "herdr",
  "paneId": "w1B:p1",
  "workspaceId": "w1B",
  "claudeCommand": "claude --dangerously-skip-permissions ..."
}
```

| Field | Type | Description |
|---|---|---|
| `dryRun` | `boolean` | `true` when produced by `-dry-run` (nothing was created) |
| `repoRoot` | `string` | Absolute path to the main repository |
| `branch` | `string \| null` | Branch name (`null` only for a detached worktree on `resume`) |
| `baseBranch` | `string \| null` | Base branch used for the worktree (`null` on `resume`) |
| `worktreePath` | `string` | Absolute path to the worktree |
| `mode` | `string` | `"pane"` or `"terminal"` (`"terminal"` only with `-dry-run` and no `-pane`) |
| `backend` | `string \| null` | `"wezterm"`, `"tmux"` or `"herdr"`; `null` in terminal mode |
| `paneId` | `number \| string \| null` | Same value as `session.paneId` in `list -json`; `null` on dry run |
| `workspaceId` | `string \| null` | herdr workspace id; `null` for other backends |
| `claudeCommand` | `string` | The Claude Code command that was (or would be) sent to the pane |

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
  "postCleanTimeout": 60,
  "herdr": { "label": "{repo}/{branch}" }
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

### herdr

- `herdr.label` — Template for the label of the herdr workspace created by `-pane` (default: `{repo}/{branch}`). `{repo}` is the repository directory name and `{branch}` is the branch name.

### Environment Variables

- `CLAUDE_WORKTREE_CACHE_DIR` — Override the slot cache directory (default: `~/.cache/claude-worktree`)
- `CLAUDE_WORKTREE_BACKEND` — Force the pane backend for `-pane`: `wezterm`, `tmux` or `herdr` (default: auto-detect, see [Pane Backends](#pane-backends)).
- `CLAUDE_WORKTREE_NO_MOUSE` — Disable mouse support in the interactive selectors (any non-empty value). Mouse tracking takes over the terminal's own text selection while a selector is open, so set this if you need to copy from the list.
- `CLAUDE_WORKTREE_NO_OSC7` — Disable reporting the worktree directory to the terminal emulator via OSC 7 (any non-empty value). The report keeps emulator-spawned panes/tabs (e.g. WezTerm splits) anchored to the worktree while Claude Code is running.
- `NO_COLOR` — Disable colored output ([no-color.org](https://no-color.org/)). Colors are also automatically disabled when stdout is not a TTY (e.g., piped output).

## License

[MIT](LICENSE)
