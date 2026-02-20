import type { BackendType } from "./wezterm.ts";

export type SessionMode = "pane" | "terminal";

export type SessionInfo = {
  paneId?: number | string; // WezTerm: number, tmux: string (e.g. "%42")
  backendType?: BackendType; // undefined treated as "wezterm" for backward compat
  mode: SessionMode;
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601, set when terminal mode completes
};

export type SessionState = {
  status: "running" | "done";
  elapsedMs: number;
  mode: SessionMode;
  paneId?: number | string;
};

export type AllPanes = {
  wezterm: { paneId: number; title: string; cwd: string }[] | null;
  tmux: { paneId: string; title: string; cwd: string }[] | null;
};
