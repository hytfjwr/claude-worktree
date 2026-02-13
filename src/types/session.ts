export type SessionMode = "pane" | "terminal";

export type SessionInfo = {
  paneId?: number; // pane mode only
  mode: SessionMode;
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601, set when terminal mode completes
};

export type SessionState = {
  status: "running" | "done";
  elapsedMs: number;
  mode: SessionMode;
  paneId?: number;
};
