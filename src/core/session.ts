import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { AllPanes, SessionInfo, SessionState } from "../types/index.ts";
import { logWarn } from "../ui/logger.ts";
import { atomicWriteJson, getCacheDir, pathExists, pruneMissingPaths, readJsonFile, withLock } from "./cache.ts";

type SessionCache = Record<string, SessionInfo>;

function isSessionInfo(value: unknown): value is SessionInfo {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const info = value as Record<string, unknown>;
  if (info.mode !== "pane" && info.mode !== "terminal") return false;
  if (typeof info.startedAt !== "string") return false;
  if (info.completedAt !== undefined && typeof info.completedAt !== "string") return false;
  if (info.paneId !== undefined && typeof info.paneId !== "number" && typeof info.paneId !== "string") return false;
  if (
    info.backendType !== undefined &&
    info.backendType !== "wezterm" &&
    info.backendType !== "tmux" &&
    info.backendType !== "herdr"
  )
    return false;
  if (info.workspaceId !== undefined && typeof info.workspaceId !== "string") return false;
  return true;
}

function isSessionCache(value: unknown): value is SessionCache {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isSessionInfo);
}

/**
 * Read the session cache for a read-only operation.
 * A corrupt or structurally invalid file degrades to an empty cache, the same
 * way the slot cache does, so a broken file never breaks `list` / `create` / `resume`.
 */
async function readSessionCache(): Promise<SessionCache> {
  return readJsonFile<SessionCache>(getSessionFile(), {}, "fallback", isSessionCache);
}

/**
 * Read the session cache before writing it back.
 *
 * Silently falling back to `{}` here would erase the live session entries of every
 * other worktree on the next write, so a corrupt file is moved aside first: the
 * data stays on disk for inspection and the caller continues from an empty cache.
 */
async function readSessionCacheForWrite(): Promise<SessionCache> {
  try {
    return await readJsonFile<SessionCache>(getSessionFile(), {}, "throw", isSessionCache);
  } catch {
    await quarantineSessionFile();
    return {};
  }
}

async function quarantineSessionFile(): Promise<void> {
  const file = getSessionFile();
  const target = `${file}.corrupt-${Date.now()}`;
  try {
    await rename(file, target);
    logWarn(`Session cache was unreadable and has been moved to ${target}`);
  } catch {
    // Best-effort: the caller proceeds with an empty cache either way.
  }
}

function getSessionFile(): string {
  return join(getCacheDir(), "sessions.json");
}

function getLockFile(): string {
  return join(getCacheDir(), "sessions.lock");
}

export async function saveSession(worktreePath: string, session: SessionInfo): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readSessionCacheForWrite();
    cache[worktreePath] = session;
    await atomicWriteJson(getSessionFile(), cache);
  });
}

export async function readSession(worktreePath: string): Promise<SessionInfo | undefined> {
  const cache = await readSessionCache();
  return cache[worktreePath];
}

export async function readAllSessions(): Promise<Record<string, SessionInfo>> {
  return readSessionCache();
}

export async function completeSession(worktreePath: string): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readSessionCacheForWrite();
    if (!cache[worktreePath]) {
      return;
    }
    cache[worktreePath].completedAt = new Date().toISOString();
    await atomicWriteJson(getSessionFile(), cache);
  });
}

export async function deleteSession(worktreePath: string): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readSessionCacheForWrite();

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

export async function fetchAllPanes(deps: {
  listWeztermPanes: () => Promise<AllPanes["wezterm"]>;
  listTmuxPanes: () => Promise<AllPanes["tmux"]>;
  listHerdrPanes: () => Promise<AllPanes["herdr"]>;
}): Promise<AllPanes> {
  const [wezterm, tmux, herdr] = await Promise.all([
    deps.listWeztermPanes().catch(() => null),
    deps.listTmuxPanes().catch(() => null),
    deps.listHerdrPanes().catch(() => null),
  ]);
  return { wezterm, tmux, herdr };
}

export function determineSessionStatus(session: SessionInfo, allPanes: AllPanes, now: Date = new Date()): SessionState {
  const startedAt = new Date(session.startedAt);
  const elapsedMs = now.getTime() - startedAt.getTime();

  // completedAt is set → Done
  if (session.completedAt) {
    return { status: "done", elapsedMs, mode: session.mode, paneId: session.paneId };
  }

  // pane mode: check if pane still exists using the correct backend
  if (session.mode === "pane" && session.paneId != null) {
    const backendType = session.backendType ?? "wezterm"; // backward compat

    if (backendType === "wezterm" && allPanes.wezterm != null) {
      const paneExists = allPanes.wezterm.some((p) => p.paneId === session.paneId);
      return {
        status: paneExists ? "running" : "done",
        elapsedMs,
        mode: session.mode,
        paneId: session.paneId,
      };
    }

    if (backendType === "tmux" && allPanes.tmux != null) {
      const paneExists = allPanes.tmux.some((p) => p.paneId === session.paneId);
      return {
        status: paneExists ? "running" : "done",
        elapsedMs,
        mode: session.mode,
        paneId: session.paneId,
      };
    }

    if (backendType === "herdr" && allPanes.herdr != null) {
      const pane = allPanes.herdr.find((p) => p.paneId === session.paneId);
      return {
        status: pane ? "running" : "done",
        elapsedMs,
        mode: session.mode,
        paneId: session.paneId,
        ...(pane && { agentStatus: pane.agentStatus }),
      };
    }
  }

  // pane mode without matching pane list (backend unavailable) → Unknown
  if (session.mode === "pane" && session.paneId != null) {
    return { status: "unknown", elapsedMs, mode: session.mode, paneId: session.paneId };
  }

  // terminal mode without completedAt → Running
  return { status: "running", elapsedMs, mode: session.mode, paneId: session.paneId };
}

export async function gcSessions(validPaths: Set<string>): Promise<number> {
  let removed = 0;

  await withLock(getLockFile(), async () => {
    const cache = await readSessionCacheForWrite();
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

/**
 * Remove session entries whose worktree directory no longer exists.
 *
 * Unlike {@link gcSessions} this needs no list of valid paths, so it is safe to
 * call from any command without knowing which repository the entries belong to.
 * Staleness is decided by path existence only, so a long-running session whose
 * worktree still exists is never removed.
 */
export async function gcMissingSessions(): Promise<number> {
  const snapshot = await readSessionCache();
  const snapshotPaths = Object.keys(snapshot);
  if (snapshotPaths.length === 0) {
    return 0;
  }
  const existence = await Promise.all(snapshotPaths.map((path) => pathExists(path)));
  if (!existence.includes(false)) {
    return 0;
  }

  let removed = 0;
  await withLock(getLockFile(), async () => {
    const cache = await readSessionCacheForWrite();
    removed = await pruneMissingPaths(cache);
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
