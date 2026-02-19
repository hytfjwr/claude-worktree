import { unlink } from "node:fs/promises";
import { join } from "node:path";

import type { SessionInfo, SessionState, WeztermPane } from "../types/index.ts";
import { atomicWriteJson, getCacheDir, readJsonFile, withLock } from "./cache.ts";

type SessionCache = Record<string, SessionInfo>;

function getSessionFile(): string {
  return join(getCacheDir(), "sessions.json");
}

function getLockFile(): string {
  return join(getCacheDir(), "sessions.lock");
}

export async function saveSession(worktreePath: string, session: SessionInfo): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SessionCache>(getSessionFile(), {});
    cache[worktreePath] = session;
    await atomicWriteJson(getSessionFile(), cache);
  });
}

export async function readSession(worktreePath: string): Promise<SessionInfo | undefined> {
  return withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SessionCache>(getSessionFile(), {});
    return cache[worktreePath];
  });
}

export async function readAllSessions(): Promise<Record<string, SessionInfo>> {
  return withLock(getLockFile(), async () => {
    return readJsonFile<SessionCache>(getSessionFile(), {});
  });
}

export async function completeSession(worktreePath: string): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SessionCache>(getSessionFile(), {});
    if (!cache[worktreePath]) {
      return;
    }
    cache[worktreePath].completedAt = new Date().toISOString();
    await atomicWriteJson(getSessionFile(), cache);
  });
}

export async function deleteSession(worktreePath: string): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SessionCache>(getSessionFile(), {});

    if (!Object.hasOwn(cache, worktreePath)) {
      return;
    }

    delete cache[worktreePath];

    if (Object.keys(cache).length === 0) {
      try {
        await unlink(getSessionFile());
      } catch {
        // File may already be deleted
      }
      return;
    }

    await atomicWriteJson(getSessionFile(), cache);
  });
}

export function determineSessionStatus(
  session: SessionInfo,
  panes: WeztermPane[] | null,
  now: Date = new Date(),
): SessionState {
  const startedAt = new Date(session.startedAt);
  const elapsedMs = now.getTime() - startedAt.getTime();

  // completedAt is set → Done
  if (session.completedAt) {
    return { status: "done", elapsedMs, mode: session.mode, paneId: session.paneId };
  }

  // pane mode: check if pane still exists (skip when panes is null = WezTerm unavailable)
  if (session.mode === "pane" && session.paneId != null && panes != null) {
    const paneExists = panes.some((p) => p.paneId === session.paneId);
    return {
      status: paneExists ? "running" : "done",
      elapsedMs,
      mode: session.mode,
      paneId: session.paneId,
    };
  }

  // terminal mode without completedAt → Running
  // pane mode without pane list (WezTerm unavailable) → Running
  return { status: "running", elapsedMs, mode: session.mode, paneId: session.paneId };
}

export async function gcSessions(validPaths: Set<string>): Promise<number> {
  let removed = 0;

  await withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SessionCache>(getSessionFile(), {});
    for (const path of Object.keys(cache)) {
      if (!validPaths.has(path)) {
        delete cache[path];
        removed++;
      }
    }

    if (removed === 0) return;

    if (Object.keys(cache).length === 0) {
      try {
        await unlink(getSessionFile());
      } catch {
        // File may already be deleted
      }
      return;
    }

    await atomicWriteJson(getSessionFile(), cache);
  });

  return removed;
}

export function formatElapsed(elapsedMs: number): string {
  const totalMin = Math.floor(elapsedMs / 60_000);
  if (totalMin < 60) {
    return `${totalMin}m`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h${mins}m`;
}
