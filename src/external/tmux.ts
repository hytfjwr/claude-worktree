import { exec } from "../core/exec.ts";
import type { PaneOptions, TmuxPane } from "../types/index.ts";

let tmuxAvailableCache: boolean | undefined;

export async function listTmuxPanes(): Promise<TmuxPane[] | null> {
  try {
    if (tmuxAvailableCache === undefined) {
      tmuxAvailableCache = await checkTmuxAvailable();
    }
    if (!tmuxAvailableCache) return null;

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

export async function closePane(paneId: string): Promise<void> {
  await exec("tmux", ["kill-pane", "-t", paneId]).quiet();
}

export async function createPane(options: PaneOptions = {}): Promise<string> {
  if (isRunningInsideTmux()) {
    // Inside tmux: split the current window
    const originalPaneId = options.keepFocus ? getCurrentPaneId() : undefined;

    const paneId = await splitPaneRight();

    if (options.keepFocus && originalPaneId) {
      await activatePane(originalPaneId);
    }

    return paneId;
  }

  // Outside tmux: create a new detached session
  return await createDetachedSession();
}

async function createDetachedSession(): Promise<string> {
  return (await exec("tmux", ["new-session", "-d", "-P", "-F", "#{pane_id}"]).text()).trim();
}

// Get the session name that contains the given pane
export async function getSessionForPane(paneId: string): Promise<string> {
  return (await exec("tmux", ["display-message", "-t", paneId, "-p", "#{session_name}"]).text()).trim();
}
