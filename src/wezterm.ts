import { $ } from "bun";

export type PaneOptions = {
  title?: string;
  keepFocus?: boolean; // trueの場合、split後に元のペインにフォーカスを戻す
};

export type WeztermDependencies = {
  execShell: (cmd: string) => Promise<string>;
  spawn: typeof Bun.spawn;
  getCurrentPaneId: () => string | undefined;
};

const defaultDependencies: WeztermDependencies = {
  execShell: async (cmd: string) => (await $`sh -c ${cmd}`.text()).trim(),
  spawn: Bun.spawn,
  getCurrentPaneId: () => process.env.WEZTERM_PANE,
};

export async function splitPaneRight(
  deps: WeztermDependencies = defaultDependencies
): Promise<string> {
  const paneId = await deps.execShell("wezterm cli split-pane --right");
  return paneId;
}

export async function setTabTitle(
  paneId: string,
  title: string,
  deps: WeztermDependencies = defaultDependencies
): Promise<void> {
  const proc = deps.spawn(["wezterm", "cli", "set-tab-title", "--pane-id", paneId, title]);
  await proc.exited;
}

export async function sendText(
  paneId: string,
  text: string,
  deps: WeztermDependencies = defaultDependencies
): Promise<void> {
  const proc = deps.spawn(["wezterm", "cli", "send-text", "--no-paste", "--pane-id", paneId], {
    stdin: new TextEncoder().encode(text),
  });
  await proc.exited;
}

export async function sendCommand(
  paneId: string,
  command: string,
  deps: WeztermDependencies = defaultDependencies
): Promise<void> {
  await sendText(paneId, command + "\n", deps);
}

// 現在のペインIDを取得（WezTermが自動設定する環境変数を使用）
export function getCurrentPaneId(
  deps: WeztermDependencies = defaultDependencies
): string | undefined {
  return deps.getCurrentPaneId();
}

// 指定ペインにフォーカスを移動
export async function activatePane(
  paneId: string,
  deps: WeztermDependencies = defaultDependencies
): Promise<void> {
  const proc = deps.spawn(["wezterm", "cli", "activate-pane", "--pane-id", paneId]);
  await proc.exited;
}

export async function createPane(
  options: PaneOptions = {},
  deps: WeztermDependencies = defaultDependencies
): Promise<string> {
  const originalPaneId = options.keepFocus ? getCurrentPaneId(deps) : undefined;

  const paneId = await splitPaneRight(deps);

  if (options.title) {
    await setTabTitle(paneId, options.title, deps);
  }

  if (options.keepFocus && originalPaneId) {
    await activatePane(originalPaneId, deps);
  }

  return paneId;
}
