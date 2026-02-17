import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Speed up lock acquisition failure tests by using minimal retries
vi.mock("./cache.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./cache.ts")>();
  return {
    ...mod,
    withLock: (lockFile: string, fn: () => Promise<unknown>) =>
      mod.withLock(lockFile, fn, { maxRetries: 2, retryIntervalMs: 1 }),
  };
});

import { createServer } from "node:net";

import { saveEnv } from "../__test-utils__.ts";
import { getCacheDir } from "./cache.ts";
import { SlotError } from "./errors.ts";
import { assignSlot, deleteSlot, findAvailableSlot, isPortInUse, readSlot, saveSlot } from "./slot.ts";

describe("slot cache", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claude-worktree-test-"));
    restoreEnv = saveEnv("CLAUDE_WORKTREE_CACHE_DIR");
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
  });

  afterEach(() => {
    restoreEnv();
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("saveSlot and readSlot: basic save and read", async () => {
    await saveSlot("/tmp/repo-feature-auth", 3);

    const slot = await readSlot("/tmp/repo-feature-auth");
    expect(slot).toBe(3);
  });

  test("readSlot returns undefined for non-existent key", async () => {
    const slot = await readSlot("/tmp/does-not-exist");
    expect(slot).toBeUndefined();
  });

  test("deleteSlot removes the entry", async () => {
    await saveSlot("/tmp/repo-feature-auth", 3);
    await deleteSlot("/tmp/repo-feature-auth");

    const slot = await readSlot("/tmp/repo-feature-auth");
    expect(slot).toBeUndefined();
  });

  test("deleteSlot removes cache file when last entry is deleted", async () => {
    await saveSlot("/tmp/repo-only", 1);
    await deleteSlot("/tmp/repo-only");

    const cacheFile = join(getCacheDir(), "slots.json");
    const exists = existsSync(cacheFile);
    expect(exists).toBe(false);
  });

  test("deleteSlot is no-op when key does not exist", async () => {
    // Should not throw or create a cache file
    await deleteSlot("/tmp/does-not-exist");

    const cacheFile = join(getCacheDir(), "slots.json");
    const exists = existsSync(cacheFile);
    expect(exists).toBe(false);
  });

  test("multiple entries are independent", async () => {
    await saveSlot("/tmp/repo-a", 1);
    await saveSlot("/tmp/repo-b", 5);

    expect(await readSlot("/tmp/repo-a")).toBe(1);
    expect(await readSlot("/tmp/repo-b")).toBe(5);

    await deleteSlot("/tmp/repo-a");

    expect(await readSlot("/tmp/repo-a")).toBeUndefined();
    expect(await readSlot("/tmp/repo-b")).toBe(5);
  });

  test("saveSlot overwrites existing entry", async () => {
    await saveSlot("/tmp/repo-a", 1);
    await saveSlot("/tmp/repo-a", 7);

    expect(await readSlot("/tmp/repo-a")).toBe(7);
  });

  test("lock acquisition failure throws LockAcquisitionError", async () => {
    // Create the lock file with current PID to simulate a held lock
    const lockFile = join(tempDir, "slots.lock");
    writeFileSync(lockFile, String(process.pid), "utf-8");

    const { LockAcquisitionError } = await import("./errors.ts");
    await expect(saveSlot("/tmp/repo-lock-test", 4)).rejects.toThrow(LockAcquisitionError);
  });
});

describe("findAvailableSlot validation", () => {
  test("rejects basePort less than 1", async () => {
    await expect(findAvailableSlot(0)).rejects.toThrow(SlotError);
    await expect(findAvailableSlot(0)).rejects.toThrow("Invalid basePort: 0");
  });

  test("rejects basePort greater than 65535", async () => {
    await expect(findAvailableSlot(65536)).rejects.toThrow(SlotError);
    await expect(findAvailableSlot(65536)).rejects.toThrow("Invalid basePort: 65536");
  });

  test("rejects non-integer basePort", async () => {
    await expect(findAvailableSlot(8880.5)).rejects.toThrow(SlotError);
    await expect(findAvailableSlot(8880.5)).rejects.toThrow("Invalid basePort: 8880.5");
  });

  test("rejects negative basePort", async () => {
    await expect(findAvailableSlot(-1)).rejects.toThrow(SlotError);
    await expect(findAvailableSlot(-1)).rejects.toThrow("Invalid basePort: -1");
  });

  test("rejects maxSlots less than 1", async () => {
    await expect(findAvailableSlot(8880, 0)).rejects.toThrow(SlotError);
    await expect(findAvailableSlot(8880, 0)).rejects.toThrow("Invalid maxSlots: 0");
  });

  test("rejects maxSlots that would exceed port range", async () => {
    await expect(findAvailableSlot(65530, 10)).rejects.toThrow(SlotError);
    await expect(findAvailableSlot(65530, 10)).rejects.toThrow("Invalid maxSlots: 10");
  });

  test("rejects non-integer maxSlots", async () => {
    await expect(findAvailableSlot(8880, 1.5)).rejects.toThrow(SlotError);
    await expect(findAvailableSlot(8880, 1.5)).rejects.toThrow("Invalid maxSlots: 1.5");
  });
});

describe("isPortInUse", () => {
  test("returns false for a free port", async () => {
    // Pick a random high port: bind it, release it, then check
    const port = await new Promise<number>((resolve) => {
      const srv = createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });
    expect(await isPortInUse(port)).toBe(false);
  });

  test("returns true for a port in use", async () => {
    const server = createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
    try {
      expect(await isPortInUse(port)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("assignSlot", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claude-worktree-test-assign-"));
    restoreEnv = saveEnv("CLAUDE_WORKTREE_CACHE_DIR");
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
  });

  afterEach(() => {
    restoreEnv();
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("assigns a slot and persists it to cache", async () => {
    const slot = await assignSlot("/tmp/repo-a");
    expect(slot).toBeGreaterThanOrEqual(1);
    expect(slot).toBeLessThanOrEqual(9);

    // Verify it was saved to cache
    const cached = await readSlot("/tmp/repo-a");
    expect(cached).toBe(slot);
  });

  test("skips already-assigned slots", async () => {
    // Pre-populate cache with slot 1
    await saveSlot("/tmp/repo-existing", 1);

    const slot = await assignSlot("/tmp/repo-new");
    // Should not assign slot 1 since it's already taken
    expect(slot).not.toBe(1);
    expect(slot).toBeGreaterThanOrEqual(1);
    expect(slot).toBeLessThanOrEqual(9);
  });

  test("throws SlotError when all slots are assigned", async () => {
    // Use maxSlots=2 to make it easy to exhaust
    await saveSlot("/tmp/repo-1", 1);
    await saveSlot("/tmp/repo-2", 2);

    await expect(assignSlot("/tmp/repo-3", 8880, 2)).rejects.toThrow(SlotError);
    await expect(assignSlot("/tmp/repo-3", 8880, 2)).rejects.toThrow("all 2 slots are assigned");
  });

  test("throws SlotError when all candidate ports are in use", async () => {
    // Occupy port by binding it, and use a single slot
    const server = createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
    try {
      // basePort = port - 1, maxSlots = 1 → only checks port
      await expect(assignSlot("/tmp/repo-x", port - 1, 1)).rejects.toThrow(SlotError);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("returns existing slot for already-assigned worktree (idempotent)", async () => {
    const firstSlot = await assignSlot("/tmp/repo-idem");
    const secondSlot = await assignSlot("/tmp/repo-idem");
    expect(secondSlot).toBe(firstSlot);
  });

  test("rejects invalid basePort", async () => {
    await expect(assignSlot("/tmp/x", 0)).rejects.toThrow(SlotError);
    await expect(assignSlot("/tmp/x", 0)).rejects.toThrow("Invalid basePort: 0");
  });

  test("rejects invalid maxSlots", async () => {
    await expect(assignSlot("/tmp/x", 8880, 0)).rejects.toThrow(SlotError);
    await expect(assignSlot("/tmp/x", 8880, 0)).rejects.toThrow("Invalid maxSlots: 0");
  });
});
