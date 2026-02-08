import { $ } from "bun";

export type PaneOptions = {
  title?: string;
  keepFocus?: boolean; // If true, restore focus to the original pane after split
};

export async function splitPaneRight(): Promise<string> {
  return (await $`wezterm cli split-pane --right`.text()).trim();
}

export async function setTabTitle(
  paneId: string,
  title: string
): Promise<void> {
  const proc = Bun.spawn(["wezterm", "cli", "set-tab-title", "--pane-id", paneId, title]);
  await proc.exited;
}

export async function sendText(
  paneId: string,
  text: string
): Promise<void> {
  // Use --no-paste (send characters directly).
  // Since we pass the prompt via heredoc format, the shell will keep
  // waiting for input until the delimiter is reached, even with newlines.
  const proc = Bun.spawn(["wezterm", "cli", "send-text", "--no-paste", "--pane-id", paneId], {
    stdin: new TextEncoder().encode(text),
  });
  await proc.exited;
}

export async function sendCommand(
  paneId: string,
  command: string
): Promise<void> {
  await sendText(paneId, command + "\n");
}

// Get current pane ID (uses the environment variable automatically set by WezTerm)
export function getCurrentPaneId(): string | undefined {
  return process.env.WEZTERM_PANE;
}

// Move focus to the specified pane
export async function activatePane(
  paneId: string
): Promise<void> {
  const proc = Bun.spawn(["wezterm", "cli", "activate-pane", "--pane-id", paneId]);
  await proc.exited;
}

export async function createPane(
  options: PaneOptions = {}
): Promise<string> {
  const originalPaneId = options.keepFocus ? getCurrentPaneId() : undefined;

  const paneId = await splitPaneRight();

  if (options.title) {
    await setTabTitle(paneId, options.title);
  }

  if (options.keepFocus && originalPaneId) {
    await activatePane(originalPaneId);
  }

  return paneId;
}
