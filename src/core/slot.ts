import { unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

import { atomicWriteJson, getCacheDir, readJsonFile, withLock } from "./cache.ts";
import { SlotError } from "./errors.ts";

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

function validateSlotParams(basePort: number, maxSlots: number): void {
  if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) {
    throw new SlotError(`Invalid basePort: ${basePort}. Must be an integer between 1 and 65535`);
  }
  if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 65535 - basePort) {
    throw new SlotError(`Invalid maxSlots: ${maxSlots}. Must be a positive integer and basePort + maxSlots <= 65535`);
  }
}

async function findAvailablePort(basePort: number, slots: number[]): Promise<number | null> {
  const results = await Promise.all(slots.map((s) => isPortInUse(basePort + s)));
  const index = results.indexOf(false);
  return index !== -1 ? slots[index] : null;
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
  validateSlotParams(basePort, maxSlots);

  return withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SlotCache>(getCacheFile(), {}, "fallback");

    // Return existing assignment if present (idempotent)
    if (Object.hasOwn(cache, worktreePath)) {
      return cache[worktreePath];
    }

    const assignedSlots = new Set(Object.values(cache));
    const candidates = Array.from({ length: maxSlots }, (_, i) => i + 1).filter((s) => !assignedSlots.has(s));
    if (candidates.length === 0) {
      throw new SlotError(`No available slots (all ${maxSlots} slots are assigned)`);
    }

    const slot = await findAvailablePort(basePort, candidates);
    if (slot === null) {
      throw new SlotError(`No available slots (all ports ${basePort + 1}-${basePort + maxSlots} are in use)`);
    }

    cache[worktreePath] = slot;
    await atomicWriteJson(getCacheFile(), cache);
    return slot;
  });
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
  return withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SlotCache>(getCacheFile(), {}, "fallback");
    return cache[worktreePath];
  });
}

export async function gcSlots(validPaths: Set<string>): Promise<number> {
  let removed = 0;

  await withLock(getLockFile(), async () => {
    const cache = await readJsonFile<SlotCache>(getCacheFile(), {}, "fallback");
    for (const path of Object.keys(cache)) {
      if (!validPaths.has(path)) {
        delete cache[path];
        removed++;
      }
    }

    if (removed === 0) return;

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

  return removed;
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
