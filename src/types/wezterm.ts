export type BackendType = "wezterm" | "tmux" | "herdr";

export type PaneOptions = {
  keepFocus?: boolean; // If true, restore focus to the original pane after split
  cwd?: string; // Working directory for the new pane. herdr passes it to `workspace create --cwd`; WezTerm/tmux ignore it (the cd is part of the sent command).
  label?: string; // Human-readable label. herdr passes it to `workspace create --label`; WezTerm/tmux ignore it.
};

/** Result of TerminalBackend.createPane. workspaceId is set only by backends that create a container around the pane (herdr). */
export type CreatedPane = {
  paneId: string;
  workspaceId?: string;
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

export type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type HerdrPane = {
  paneId: string; // e.g. "w1B:p1"
  workspaceId: string; // e.g. "w1B"
  title: string;
  cwd: string;
  agentStatus: HerdrAgentStatus;
};

export type TerminalBackend = {
  name: BackendType;
  createPane: (options?: PaneOptions) => Promise<CreatedPane>;
  sendCommand: (paneId: string, command: string) => Promise<void>;
  closePane: (pane: CreatedPane) => Promise<void>;
};
