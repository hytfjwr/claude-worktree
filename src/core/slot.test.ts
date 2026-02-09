import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { deleteSlot, getCacheDir, readSlot, saveSlot } from "./slot";

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
});
