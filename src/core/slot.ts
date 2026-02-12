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
