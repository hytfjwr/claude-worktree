import { unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { atomicWriteJson, readJsonFile, withLock } from "./cache.ts";

export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(true);
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function findAvailableSlot(basePort: number = 8880, maxSlots: number = 9): Promise<number> {
  if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) {
    throw new Error(`Invalid basePort: ${basePort}. Must be an integer between 1 and 65535`);
  }
  if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 65535 - basePort) {
    throw new Error(`Invalid maxSlots: ${maxSlots}. Must be a positive integer and basePort + maxSlots <= 65535`);
  }
  // Check all ports in parallel
  const results = await Promise.all(Array.from({ length: maxSlots }, (_, i) => isPortInUse(basePort + i + 1)));
  const slotIndex = results.indexOf(false);
  if (slotIndex !== -1) {
    return slotIndex + 1;
  }
  throw new Error(`No available slots (all ports ${basePort + 1}-${basePort + maxSlots} are in use)`);
}

/**
 * Find an available slot and reserve it for the given worktree path.
 *
 * Uses a file lock to read existing assignments, check port availability
 * (skipping already-assigned slots), and write the updated cache.
 * If the worktree already has an assigned slot, the existing slot is returned
 * without modification (idempotent).
 *
 * Throws {@link LockAcquisitionError} if the lock cannot be acquired after
 * retries. Stale locks (left by crashed processes) are automatically detected
 * and removed.
 */
export async function assignSlot(worktreePath: string, basePort: number = 8880, maxSlots: number = 9): Promise<number> {
  if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) {
    throw new Error(`Invalid basePort: ${basePort}. Must be an integer between 1 and 65535`);
  }
  if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 65535 - basePort) {
    throw new Error(`Invalid maxSlots: ${maxSlots}. Must be a positive integer and basePort + maxSlots <= 65535`);
  }

  return withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SlotCache>(getCacheFile(), {}, "fallback");

    // Return existing assignment if present (idempotent)
    if (Object.hasOwn(cache, worktreePath)) {
      return cache[worktreePath];
    }

    const assignedSlots = new Set(Object.values(cache));

    // Check ports in parallel, but only for slots not already assigned in cache
    const candidates = Array.from({ length: maxSlots }, (_, i) => i + 1).filter((s) => !assignedSlots.has(s));
    if (candidates.length === 0) {
      throw new Error(`No available slots (all ${maxSlots} slots are assigned)`);
    }

    const portResults = await Promise.all(candidates.map((s) => isPortInUse(basePort + s)));
    const availableIndex = portResults.indexOf(false);
    if (availableIndex === -1) {
      throw new Error(`No available slots (all ports ${basePort + 1}-${basePort + maxSlots} are in use)`);
    }

    const slot = candidates[availableIndex];
    cache[worktreePath] = slot;
    await atomicWriteJson(getCacheFile(), cache);
    return slot;
  });
}

// Slot cache: persists worktree path → slot number mappings
export function getCacheDir(): string {
  return join(process.env.CLAUDE_WORKTREE_CACHE_DIR || join(homedir(), ".cache", "claude-worktree"));
}

function getCacheFile(): string {
  return join(getCacheDir(), "slots.json");
}

function getLockFile(): string {
  return join(getCacheDir(), "slots.lock");
}

type SlotCache = Record<string, number>;

export async function saveSlot(worktreePath: string, slot: number): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SlotCache>(getCacheFile(), {}, "fallback");
    cache[worktreePath] = slot;
    await atomicWriteJson(getCacheFile(), cache);
  });
}

export async function readSlot(worktreePath: string): Promise<number | undefined> {
  const cache = await readJsonFile<SlotCache>(getCacheFile(), {}, "fallback");
  return cache[worktreePath];
}

export async function deleteSlot(worktreePath: string): Promise<void> {
  await withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SlotCache>(getCacheFile(), {}, "fallback");

    if (!Object.hasOwn(cache, worktreePath)) {
      return;
    }

    delete cache[worktreePath];

    if (Object.keys(cache).length === 0) {
      try {
        await unlink(getCacheFile());
      } catch {
        // File may already be deleted
      }
      return;
    }

    await atomicWriteJson(getCacheFile(), cache);
  });
}
