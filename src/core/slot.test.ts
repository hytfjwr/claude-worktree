import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { deleteSlot, findAvailableSlot, getCacheDir, readSlot, saveSlot } from "./slot.ts";

describe("slot cache", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Use a temp directory to avoid touching the real cache
    tempDir = mkdtempSync(join(tmpdir(), "claude-worktree-test-"));
    originalEnv = process.env.CLAUDE_WORKTREE_CACHE_DIR;
    process.env.CLAUDE_WORKTREE_CACHE_DIR = tempDir;
  });

  afterEach(() => {
    // Restore env and clean up temp directory
    if (originalEnv !== undefined) {
      process.env.CLAUDE_WORKTREE_CACHE_DIR = originalEnv;
    } else {
      delete process.env.CLAUDE_WORKTREE_CACHE_DIR;
    }
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("getCacheDir respects CLAUDE_WORKTREE_CACHE_DIR env var", () => {
    expect(getCacheDir()).toBe(tempDir);
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

  test("lock acquisition failure emits warning and operation still succeeds", { timeout: 10000 }, async () => {
    // Create the lock file manually to simulate a held lock
    const lockFile = join(tempDir, "slots.lock");
    writeFileSync(lockFile, "held", "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await saveSlot("/tmp/repo-lock-test", 4);

      // Warning should have been emitted
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Lock acquisition failed for slots.lock"));

      // Operation should still succeed
      const slot = await readSlot("/tmp/repo-lock-test");
      expect(slot).toBe(4);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("findAvailableSlot validation", () => {
  test("rejects basePort less than 1", async () => {
    await expect(findAvailableSlot(0)).rejects.toThrow("Invalid basePort: 0");
  });

  test("rejects basePort greater than 65535", async () => {
    await expect(findAvailableSlot(65536)).rejects.toThrow("Invalid basePort: 65536");
  });

  test("rejects non-integer basePort", async () => {
    await expect(findAvailableSlot(8880.5)).rejects.toThrow("Invalid basePort: 8880.5");
  });

  test("rejects negative basePort", async () => {
    await expect(findAvailableSlot(-1)).rejects.toThrow("Invalid basePort: -1");
  });

  test("rejects maxSlots less than 1", async () => {
    await expect(findAvailableSlot(8880, 0)).rejects.toThrow("Invalid maxSlots: 0");
  });

  test("rejects maxSlots that would exceed port range", async () => {
    await expect(findAvailableSlot(65530, 10)).rejects.toThrow("Invalid maxSlots: 10");
  });

  test("rejects non-integer maxSlots", async () => {
    await expect(findAvailableSlot(8880, 1.5)).rejects.toThrow("Invalid maxSlots: 1.5");
  });
});
