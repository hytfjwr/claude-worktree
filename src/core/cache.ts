import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { logDebug } from "../ui/logger.ts";
import { isNodeError, LockAcquisitionError } from "./errors.ts";

export function getCacheDir(): string {
  return join(process.env.CLAUDE_WORKTREE_CACHE_DIR || join(homedir(), ".cache", "claude-worktree"));
}

export const LOCK_MAX_RETRIES = 50;
export const LOCK_RETRY_INTERVAL_MS = 100;

/** If a lock file is older than this, consider the owning process likely dead. */
export const STALE_LOCK_THRESHOLD_MS = 30_000;

export interface LockOptions {
  maxRetries?: number;
  retryIntervalMs?: number;
}

/**
 * Check whether the process that wrote the lock file is still alive.
 * Returns `true` when the lock is stale and safe to remove.
 */
async function isStaleLock(lockFile: string): Promise<boolean> {
  try {
    const content = await readFile(lockFile, "utf-8");
    const pid = Number.parseInt(content.trim(), 10);
    if (Number.isNaN(pid)) {
      // Lock file doesn't contain a valid PID — treat as stale
      return true;
    }
    try {
      // signal 0 doesn't kill the process; it just checks existence
      process.kill(pid, 0);
      return false; // process is still alive
    } catch {
      return true; // process no longer exists
    }
  } catch {
    // Cannot read the lock file (e.g. already removed) — not stale, just gone
    return false;
  }
}

/**
 * Try to remove a stale lock file. Returns `true` if successfully removed.
 *
 * Note: there is a small TOCTOU window between the staleness check and
 * `unlink`, but the 30 s age threshold + PID liveness check make the race
 * negligible for a single-user CLI tool.
 */
async function tryRemoveStaleLock(lockFile: string): Promise<boolean> {
  try {
    // Re-check staleness and age before removing
    const info = await stat(lockFile);
    const ageMs = Date.now() - info.mtimeMs;
    if (ageMs < STALE_LOCK_THRESHOLD_MS) {
      return false; // too fresh — the owner may still be starting up
    }
    if (!(await isStaleLock(lockFile))) {
      return false;
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

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      handle = await open(lockFile, "wx");
      break;
    } catch {
      // On the last few retries, attempt stale lock removal
      if (i >= maxRetries - 2) {
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
  await rename(tempFile, filePath);
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: T,
  onParseError: "throw" | "fallback" = "throw",
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

  try {
    return JSON.parse(data) as T;
  } catch (err: unknown) {
    if (onParseError === "fallback") {
      return fallback;
    }
    throw err;
  }
}
