import { spawn } from "node:child_process";

import { DependencyError } from "../core/errors.ts";
import { exec } from "../core/exec.ts";
import type { WeztermPane } from "../types/index.ts";

function isRawWeztermPane(value: unknown): boolean {
  const v = value as Record<string, unknown>;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof v.pane_id === "number" &&
    typeof v.title === "string" &&
    typeof v.cwd === "string"
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
    if (!parsed.every(isRawWeztermPane)) return null;
    return parsed.map((p: Record<string, unknown>) => ({
      paneId: p.pane_id as number,
      title: p.title as string,
      cwd: p.cwd as string,
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

export function isRunningInsideWezterm(): boolean {
  return process.env.WEZTERM_PANE !== undefined;
}

export async function ensureWeztermAvailable(
  checkFn: () => Promise<boolean>,
  usageHint: string,
  isInsideFn: () => boolean = isRunningInsideWezterm,
): Promise<void> {
  const available = await checkFn();
  if (!available) {
    const installHint =
      process.platform === "darwin"
        ? "  brew install --cask wezterm    # macOS (Homebrew)"
        : process.platform === "linux"
          ? "  https://wezfurlong.org/wezterm/install/linux.html"
          : "  https://wezfurlong.org/wezterm/installation.html";

    throw new DependencyError(
      "WezTerm CLI is not installed. The -pane option requires WezTerm.\n\n" +
        `Install WezTerm:\n${installHint}\n\n` +
        "Or run without -pane to use the current terminal:\n" +
        `  ${usageHint}`,
    );
  }

  if (!isInsideFn()) {
    const currentTerminal = process.env.TERM_PROGRAM || "unknown terminal";
    throw new DependencyError(
      `The -pane option requires running inside WezTerm, but the current terminal is ${currentTerminal}.\n\n` +
        "Run without -pane to use the current terminal:\n" +
        `  ${usageHint}`,
    );
  }
}

import type { PaneOptions } from "../types/index.ts";

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
