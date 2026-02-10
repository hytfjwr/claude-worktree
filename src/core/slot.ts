import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { exec } from "./exec.ts";

export async function isPortInUse(port: number): Promise<boolean> {
  const result = await exec("lsof", [`-iTCP:${port}`, "-sTCP:LISTEN"])
    .nothrow()
    .quiet();
  return result.exitCode === 0;
}

export async function findAvailableSlot(basePort: number = 8880, maxSlots: number = 9): Promise<number> {
  for (let i = 1; i <= maxSlots; i++) {
    const port = basePort + i;
    if (!(await isPortInUse(port))) {
      return i;
    }
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

async function readCache(): Promise<SlotCache> {
  try {
    const data = await readFile(getCacheFile(), "utf-8");
    return JSON.parse(data) as SlotCache;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    // Parse errors or other read errors: return empty cache
    return {};
  }
}

async function writeCache(cache: SlotCache): Promise<void> {
  const cacheFile = getCacheFile();
  const tempFile = `${cacheFile}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempFile, JSON.stringify(cache, null, 2), "utf-8");
  await rename(tempFile, cacheFile);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const cacheDir = getCacheDir();
  await mkdir(cacheDir, { recursive: true });
  const lockFile = getLockFile();
  // Acquire exclusive lock via O_CREAT|O_EXCL
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
    // If lock acquisition fails after retries, proceed without lock
    // to avoid blocking the CLI indefinitely
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

export async function saveSlot(worktreePath: string, slot: number): Promise<void> {
  await withLock(async () => {
    const cache = await readCache();
    cache[worktreePath] = slot;
    await writeCache(cache);
  });
}

export async function readSlot(worktreePath: string): Promise<number | undefined> {
  const cache = await readCache();
  return cache[worktreePath];
}

export async function deleteSlot(worktreePath: string): Promise<void> {
  await withLock(async () => {
    const cache = await readCache();

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

    await writeCache(cache);
  });
}
