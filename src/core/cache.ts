import { access, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

import type { LockOptions } from "../types/index.ts";
import { logDebug } from "../ui/logger.ts";
import { isNodeError, LockAcquisitionError } from "./errors.ts";

export type { LockOptions } from "../types/index.ts";

export function getCacheDir(): string {
  return join(process.env.CLAUDE_WORKTREE_CACHE_DIR || join(homedir(), ".cache", "claude-worktree"));
}

export const LOCK_MAX_RETRIES = 50;
export const LOCK_RETRY_INTERVAL_MS = 100;

/** Number of retries before attempting stale lock detection. */
export const STALE_LOCK_CHECK_START = 10;

/**
 * A lock file whose PID cannot be read (empty or malformed) is only treated as
 * stale after this age. It covers the small window between `open(..., "wx")`
 * and the PID write in {@link withLock}. A lock file with a readable but dead
 * PID is reclaimed immediately, regardless of age.
 */
export const STALE_LOCK_THRESHOLD_MS = 30_000;

type LockOwnerState = "alive" | "dead" | "unknown";

/**
 * Determine the state of the process that wrote the lock file.
 *
 * - `alive`: the recorded PID is a running process (never steal the lock)
 * - `dead`: the recorded PID no longer exists (safe to reclaim immediately)
 * - `unknown`: the lock file has no readable PID yet (owner may be starting up)
 */
async function readLockOwnerState(lockFile: string): Promise<LockOwnerState> {
  let content: string;
  try {
    content = await readFile(lockFile, "utf-8");
  } catch {
    return "unknown";
  }

  const pid = Number.parseInt(content.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return "unknown";
  }

  try {
    // signal 0 doesn't kill the process; it just checks existence
    process.kill(pid, 0);
    return "alive";
  } catch (err) {
    // EPERM means the process exists but is owned by another user — still alive.
    if (isNodeError(err) && err.code === "EPERM") {
      return "alive";
    }
    return "dead";
  }
}

/**
 * Try to remove a stale lock file. Returns `true` if successfully removed.
 *
 * A lock whose recorded PID is dead is removed immediately — a dead PID is dead
 * regardless of how recently it died, and waiting for an age threshold made
 * recovery impossible within the retry budget. The age threshold is still
 * applied when the PID cannot be read at all, which is the only case where a
 * live owner could be mistaken for a dead one.
 *
 * Note: there is a small TOCTOU window between the staleness check and
 * `unlink`, but the PID liveness check makes the race negligible for a
 * single-user CLI tool.
 */
async function tryRemoveStaleLock(lockFile: string): Promise<boolean> {
  try {
    const state = await readLockOwnerState(lockFile);
    if (state === "alive") {
      return false;
    }
    if (state === "unknown") {
      // The owner may still be starting up (PID not written yet). Only reclaim
      // once the file is older than a live owner could plausibly leave it empty.
      const info = await stat(lockFile);
      if (Date.now() - info.mtimeMs < STALE_LOCK_THRESHOLD_MS) {
        return false;
      }
    }
    await unlink(lockFile);
    logDebug(`Removed stale lock file: ${lockFile}`);
    return true;
  } catch {
    return false;
  }
}

export async function withLock<T>(lockFile: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? LOCK_MAX_RETRIES;
  const retryIntervalMs = options?.retryIntervalMs ?? LOCK_RETRY_INTERVAL_MS;

  await mkdir(dirname(lockFile), { recursive: true });

  const staleCheckStart = Math.min(STALE_LOCK_CHECK_START, Math.max(maxRetries - 2, 0));

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      handle = await open(lockFile, "wx");
      break;
    } catch {
      // After initial retries, attempt stale lock removal on each retry
      if (i >= staleCheckStart) {
        const removed = await tryRemoveStaleLock(lockFile);
        if (removed) {
          // Try to acquire immediately after removing the stale lock
          try {
            handle = await open(lockFile, "wx");
            break;
          } catch {
            // Another process may have grabbed it — fall through to normal retry
          }
        }
      }
      await setTimeout(retryIntervalMs);
    }
  }

  if (!handle) {
    throw new LockAcquisitionError(lockFile);
  }

  // Write our PID so other processes can detect stale locks
  try {
    await handle.writeFile(String(process.pid));
  } catch {
    // Best-effort — lock is still held even if PID write fails
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

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tempFile = `${filePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), "utf-8");
  try {
    await rename(tempFile, filePath);
  } catch (err) {
    try {
      await unlink(tempFile);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: T,
  onParseError: "throw" | "fallback" = "throw",
  validate?: (data: unknown) => data is T,
): Promise<T> {
  let data: string;
  try {
    data = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return fallback;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err: unknown) {
    if (onParseError === "fallback") {
      return fallback;
    }
    throw err;
  }

  if (validate && !validate(parsed)) {
    if (onParseError === "fallback") {
      return fallback;
    }
    throw new Error(`Invalid JSON structure in ${filePath}`);
  }

  return parsed as T;
}

/** Whether a filesystem path currently exists. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove cache entries whose key (a worktree path) no longer exists on disk.
 *
 * Mutates `cache` in place and returns the number of removed entries. Staleness
 * is decided purely by path existence — never by elapsed time — so a long-running
 * session is never reclaimed.
 *
 * Callers must already hold the corresponding cache lock.
 */
export async function pruneMissingPaths<T>(cache: Record<string, T>): Promise<number> {
  const paths = Object.keys(cache);
  if (paths.length === 0) {
    return 0;
  }
  const existence = await Promise.all(paths.map((path) => pathExists(path)));
  let removed = 0;
  for (const [i, path] of paths.entries()) {
    if (!existence[i]) {
      delete cache[path];
      removed++;
    }
  }
  return removed;
}
