import { $ } from "bun";

import type { WeztermPane } from "../types";

export async function listWeztermPanes(): Promise<WeztermPane[] | null> {
  try {
    const available = await checkWeztermAvailable();
    if (!available) return null;

    const result = await $`wezterm cli list --format json`.nothrow().quiet();
    if (result.exitCode !== 0) return null;
    return JSON.parse(result.text()).map((p: { pane_id: number; title: string; cwd: string }) => ({
      pane_id: p.pane_id,
      title: p.title,
      cwd: p.cwd,
    }));
  } catch {
    return null;
  }
}

export async function checkWeztermAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "wezterm"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

import type { PaneOptions } from "../types";

export async function splitPaneRight(): Promise<string> {
  return (await $`wezterm cli split-pane --right`.text()).trim();
}

export async function sendText(paneId: string, text: string): Promise<void> {
  // Use --no-paste (send characters directly).
  // Since we pass the prompt via heredoc format, the shell will keep
  // waiting for input until the delimiter is reached, even with newlines.
  const proc = Bun.spawn(["wezterm", "cli", "send-text", "--no-paste", "--pane-id", paneId], {
    stdin: new TextEncoder().encode(text),
  });
  await proc.exited;
}

export async function sendCommand(paneId: string, command: string): Promise<void> {
  await sendText(paneId, `${command}\n`);
}

// Get current pane ID (uses the environment variable automatically set by WezTerm)
export function getCurrentPaneId(): string | undefined {
  return process.env.WEZTERM_PANE;
}

// Move focus to the specified pane
export async function activatePane(paneId: string): Promise<void> {
  const proc = Bun.spawn(["wezterm", "cli", "activate-pane", "--pane-id", paneId]);
  await proc.exited;
}

export async function createPane(options: PaneOptions = {}): Promise<string> {
  const originalPaneId = options.keepFocus ? getCurrentPaneId() : undefined;

  const paneId = await splitPaneRight();

  if (options.keepFocus && originalPaneId) {
    await activatePane(originalPaneId);
  }

  return paneId;
}
