import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

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
    console.warn("\u26a0\ufe0f  Lock acquisition failed for slots.lock, proceeding without lock");
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
