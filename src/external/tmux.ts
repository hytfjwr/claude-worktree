import { DependencyError } from "../core/errors.ts";
import { exec } from "../core/exec.ts";
import type { PaneOptions, TmuxPane } from "../types/index.ts";

export async function listTmuxPanes(): Promise<TmuxPane[] | null> {
  try {
    const available = await checkTmuxAvailable();
    if (!available) return null;

    // List all panes with pane_id, pane_title, pane_current_path
    const result = await exec("tmux", ["list-panes", "-a", "-F", "#{pane_id}\t#{pane_title}\t#{pane_current_path}"])
      .nothrow()
      .quiet();

    if (result.exitCode !== 0) return null;

    const output = result.text().trim();
    if (!output) return [];

    const panes: TmuxPane[] = [];
    for (const line of output.split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        panes.push({
          paneId: parts[0], // e.g. "%42"
          title: parts[1],
          cwd: parts[2],
        });
      }
    }
    return panes;
  } catch {
    return null;
  }
}

export async function checkTmuxAvailable(): Promise<boolean> {
  try {
    const result = await exec("which", ["tmux"]).nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export function isRunningInsideTmux(): boolean {
  return process.env.TMUX !== undefined;
}

export async function ensureTmuxAvailable(
  checkFn: () => Promise<boolean>,
  usageHint: string,
  isInsideFn: () => boolean = isRunningInsideTmux,
): Promise<void> {
  const available = await checkFn();
  if (!available) {
    const installHint =
      process.platform === "darwin"
        ? "  brew install tmux    # macOS (Homebrew)"
        : process.platform === "linux"
          ? "  sudo apt install tmux    # Debian/Ubuntu\n  sudo dnf install tmux    # Fedora/RHEL"
          : "  https://github.com/tmux/tmux/wiki/Installing";

    throw new DependencyError(
      "tmux is not installed. The -pane option requires WezTerm or tmux.\n\n" +
        `Install tmux:\n${installHint}\n\n` +
        "Or run without -pane to use the current terminal:\n" +
        `  ${usageHint}`,
    );
  }

  if (!isInsideFn()) {
    const currentTerminal = process.env.TERM_PROGRAM || "unknown terminal";
    throw new DependencyError(
      `The -pane option requires running inside WezTerm or tmux, but the current terminal is ${currentTerminal}.\n\n` +
        "Start a tmux session first:\n" +
        "  tmux new-session\n\n" +
        "Or run without -pane to use the current terminal:\n" +
        `  ${usageHint}`,
    );
  }
}

export async function splitPaneRight(): Promise<string> {
  return (await exec("tmux", ["split-window", "-h", "-P", "-F", "#{pane_id}"]).text()).trim();
}

export async function sendKeys(paneId: string, text: string): Promise<void> {
  // tmux send-keys sends literal key sequences to the target pane.
  // We split the text by newline and send each line, inserting Enter for newlines.
  await exec("tmux", ["send-keys", "-t", paneId, "-l", text]).quiet();
}

export async function sendCommand(paneId: string, command: string): Promise<void> {
  // Send command text and then press Enter
  await sendKeys(paneId, command);
  await exec("tmux", ["send-keys", "-t", paneId, "Enter"]).quiet();
}

// Get current pane ID in tmux session
export function getCurrentPaneId(): string | undefined {
  // TMUX_PANE is set by tmux to the current pane ID (e.g., "%0")
  return process.env.TMUX_PANE;
}

// Move focus to the specified pane
export async function activatePane(paneId: string): Promise<void> {
  await exec("tmux", ["select-pane", "-t", paneId]).quiet();
}

export async function createPane(options: PaneOptions = {}): Promise<string> {
  const originalPaneId = options.keepFocus ? getCurrentPaneId() : undefined;

  const paneId = await splitPaneRight();

  if (options.keepFocus && originalPaneId) {
    await activatePane(originalPaneId);
  }

  return paneId;
}
