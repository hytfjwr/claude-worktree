import { spawn } from "node:child_process";

import { exec } from "../core/exec.ts";
import type { WeztermPane } from "../types.ts";

function isWeztermPane(value: unknown): value is { pane_id: number; title: string; cwd: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "pane_id" in value &&
    typeof (value as Record<string, unknown>).pane_id === "number" &&
    "title" in value &&
    typeof (value as Record<string, unknown>).title === "string" &&
    "cwd" in value &&
    typeof (value as Record<string, unknown>).cwd === "string"
  );
}

export async function listWeztermPanes(): Promise<WeztermPane[] | null> {
  try {
    const available = await checkWeztermAvailable();
    if (!available) return null;

    const result = await exec("wezterm", ["cli", "list", "--format", "json"]).nothrow().quiet();
    if (result.exitCode !== 0) return null;
    const parsed: unknown = JSON.parse(result.text());
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every(isWeztermPane)) return null;
    return parsed.map((p) => ({
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
    const result = await exec("which", ["wezterm"]).nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

import type { PaneOptions } from "../types.ts";

export async function splitPaneRight(): Promise<string> {
  return (await exec("wezterm", ["cli", "split-pane", "--right"]).text()).trim();
}

export async function sendText(paneId: string, text: string): Promise<void> {
  // Use --no-paste (send characters directly).
  // Since we pass the prompt via heredoc format, the shell will keep
  // waiting for input until the delimiter is reached, even with newlines.
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("wezterm", ["cli", "send-text", "--no-paste", "--pane-id", paneId], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`wezterm send-text failed with exit code ${code}`));
      }
    });
    proc.stdin.end(text);
  });
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
  await exec("wezterm", ["cli", "activate-pane", "--pane-id", paneId]).quiet();
}

export async function createPane(options: PaneOptions = {}): Promise<string> {
  const originalPaneId = options.keepFocus ? getCurrentPaneId() : undefined;

  const paneId = await splitPaneRight();

  if (options.keepFocus && originalPaneId) {
    await activatePane(originalPaneId);
  }

  return paneId;
}
