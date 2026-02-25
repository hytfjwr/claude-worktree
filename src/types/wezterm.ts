export type BackendType = "wezterm" | "tmux";

export type PaneOptions = {
  keepFocus?: boolean; // If true, restore focus to the original pane after split
};

export type WeztermPane = {
  paneId: number;
  title: string;
  cwd: string;
};

export type TmuxPane = {
  paneId: string; // e.g. "%42"
  title: string;
  cwd: string;
};

export type TerminalBackend = {
  name: BackendType;
  createPane: (options?: PaneOptions) => Promise<string>;
  sendCommand: (paneId: string, command: string) => Promise<void>;
  closePane: (paneId: string) => Promise<void>;
};
