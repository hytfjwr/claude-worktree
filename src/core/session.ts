import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import type { SessionInfo, SessionState, WeztermPane } from "../types.ts";
import { icons } from "../ui/icons.ts";
import { isNodeError } from "./errors.ts";
import { getCacheDir } from "./slot.ts";

type SessionCache = Record<string, SessionInfo>;

function getSessionFile(): string {
  return join(getCacheDir(), "sessions.json");
}

function getLockFile(): string {
  return join(getCacheDir(), "sessions.lock");
}

async function readCache(): Promise<SessionCache> {
  try {
    const data = await readFile(getSessionFile(), "utf-8");
    return JSON.parse(data) as SessionCache;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeCache(cache: SessionCache): Promise<void> {
  const sessionFile = getSessionFile();
  const tempFile = `${sessionFile}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempFile, JSON.stringify(cache, null, 2), "utf-8");
  await rename(tempFile, sessionFile);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const cacheDir = getCacheDir();
  await mkdir(cacheDir, { recursive: true });
  const lockFile = getLockFile();
  const maxRetries = 50;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      handle = await open(lockFile, "wx");
      break;
    } catch {
      await setTimeout(100);
    }
  }
  if (!handle) {
    console.warn(`${icons.warning()}  Lock acquisition failed for sessions.lock, proceeding without lock`);
    return fn();
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    try {
      await unlink(lockFile);
    } catch {
      // Lock file may already be removed
    }
  }
}

export async function saveSession(worktreePath: string, session: SessionInfo): Promise<void> {
  await withLock(async () => {
    const cache = await readCache();
    cache[worktreePath] = session;
    await writeCache(cache);
  });
}

export async function readSession(worktreePath: string): Promise<SessionInfo | undefined> {
  const cache = await readCache();
  return cache[worktreePath];
}

export async function readAllSessions(): Promise<Record<string, SessionInfo>> {
  return readCache();
}

export async function completeSession(worktreePath: string): Promise<void> {
  await withLock(async () => {
    const cache = await readCache();
    if (!cache[worktreePath]) {
      return;
    }
    cache[worktreePath].completedAt = new Date().toISOString();
    await writeCache(cache);
  });
}

export async function deleteSession(worktreePath: string): Promise<void> {
  await withLock(async () => {
    const cache = await readCache();

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

    await writeCache(cache);
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
    const paneExists = panes.some((p) => p.pane_id === session.paneId);
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
