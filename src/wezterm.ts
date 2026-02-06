import { $ } from "bun";

export type PaneOptions = {
  title?: string;
  keepFocus?: boolean; // trueの場合、split後に元のペインにフォーカスを戻す
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
  // --no-paste を使用（文字を直接送信）
  // ヒアドキュメント形式でプロンプトを渡すため、改行があっても
  // シェルはデリミタが来るまで入力を待ち続ける
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

// 現在のペインIDを取得（WezTermが自動設定する環境変数を使用）
export function getCurrentPaneId(): string | undefined {
  return process.env.WEZTERM_PANE;
}

// 指定ペインにフォーカスを移動
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
