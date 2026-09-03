import { hostname } from "node:os";

/**
 * OSC 7 reports the shell's current working directory to the terminal emulator,
 * normally emitted by the shell on every prompt. While Claude Code runs as a
 * long-lived child process in a worktree directory, the shell never prints a
 * prompt, so the emulator keeps believing the pane is still in the directory it
 * was in before launch. That makes emulator features like "open new pane/tab
 * here" (e.g. WezTerm splits) land in the main repo instead of the worktree.
 */

/** Percent-encode a filesystem path for a file:// URL, keeping "/" separators intact. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Build an OSC 7 sequence reporting `path` as the current working directory.
 * Format: ESC ] 7 ; file://<host><percent-encoded path> ESC \
 */
export function buildOsc7(path: string, host: string): string {
  return `\x1b]7;file://${host}${encodePath(path)}\x1b\\`;
}

/**
 * Report `path` to the terminal emulator as the current working directory.
 * No-op when stdout is not a TTY, or when CLAUDE_WORKTREE_NO_OSC7 is set to a non-empty value.
 */
export function reportTerminalCwd(path: string): void {
  if (!process.stdout.isTTY) return;
  if ((process.env.CLAUDE_WORKTREE_NO_OSC7 ?? "") !== "") return;

  process.stdout.write(buildOsc7(path, hostname()));
}
