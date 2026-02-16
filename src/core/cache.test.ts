import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { atomicWriteJson, getCacheDir, readJsonFile, STALE_LOCK_THRESHOLD_MS, withLock } from "./cache.ts";
import { LockAcquisitionError } from "./errors.ts";

describe("withLock", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cache-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("executes fn and returns its result", async () => {
    const lockFile = join(tempDir, "test.lock");
    const result = await withLock(lockFile, async () => 42);
    expect(result).toBe(42);
  });

  test("creates parent directory if missing", async () => {
    const lockFile = join(tempDir, "sub", "dir", "test.lock");
    const result = await withLock(lockFile, async () => "ok");
    expect(result).toBe("ok");
  });

  test("writes PID to lock file during execution", async () => {
    const lockFile = join(tempDir, "pid.lock");
    let lockContent = "";
    await withLock(lockFile, async () => {
      lockContent = await readFile(lockFile, "utf-8");
    });
    expect(lockContent.trim()).toBe(String(process.pid));
  });

  test("throws LockAcquisitionError when lock is held by a live process", async () => {
    const lockFile = join(tempDir, "held.lock");
    // Write current PID so the lock appears to be held by a live process
    await writeFile(lockFile, String(process.pid), "utf-8");

    await expect(withLock(lockFile, async () => "unreachable", { maxRetries: 3, retryIntervalMs: 1 })).rejects.toThrow(
      LockAcquisitionError,
    );
  });

  test("removes stale lock from dead process and acquires lock", async () => {
    const lockFile = join(tempDir, "stale.lock");
    // PID 999999 is extremely unlikely to be running
    await writeFile(lockFile, "999999", "utf-8");
    // Backdate the mtime to exceed stale threshold
    const old = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS - 1000);
    await utimes(lockFile, old, old);

    const result = await withLock(lockFile, async () => "recovered", { maxRetries: 3, retryIntervalMs: 1 });
    expect(result).toBe("recovered");
  });

  test("removes stale lock with invalid PID content and acquires lock", async () => {
    const lockFile = join(tempDir, "invalid-pid.lock");
    await writeFile(lockFile, "not-a-pid", "utf-8");
    const old = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS - 1000);
    await utimes(lockFile, old, old);

    const result = await withLock(lockFile, async () => "recovered", { maxRetries: 3, retryIntervalMs: 1 });
    expect(result).toBe("recovered");
  });

  test("acquires lock after stale lock removal on final retry", async () => {
    const lockFile = join(tempDir, "final-retry.lock");
    await writeFile(lockFile, "999999", "utf-8");
    const old = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS - 1000);
    await utimes(lockFile, old, old);

    // maxRetries: 2 → stale check triggers at i >= 0 (maxRetries - 2), covering the final iteration
    const result = await withLock(lockFile, async () => "final-ok", { maxRetries: 2, retryIntervalMs: 1 });
    expect(result).toBe("final-ok");
  });

  test("cleans up lock file after successful execution", async () => {
    const lockFile = join(tempDir, "cleanup.lock");
    await withLock(lockFile, async () => "done");

    // The lock file should be removed after withLock completes
    const { existsSync } = await import("node:fs");
    expect(existsSync(lockFile)).toBe(false);
  });
});

describe("atomicWriteJson", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cache-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("writes JSON to file", async () => {
    const filePath = join(tempDir, "data.json");
    await atomicWriteJson(filePath, { key: "value" });

    const content = await readFile(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual({ key: "value" });
  });

  test("overwrites existing file atomically", async () => {
    const filePath = join(tempDir, "data.json");
    await atomicWriteJson(filePath, { version: 1 });
    await atomicWriteJson(filePath, { version: 2 });

    const content = await readFile(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual({ version: 2 });
  });
});

describe("readJsonFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cache-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("reads and parses JSON", async () => {
    const filePath = join(tempDir, "data.json");
    await writeFile(filePath, JSON.stringify({ a: 1 }), "utf-8");

    const result = await readJsonFile(filePath, {});
    expect(result).toEqual({ a: 1 });
  });

  test("returns fallback when file does not exist", async () => {
    const result = await readJsonFile(join(tempDir, "missing.json"), { default: true });
    expect(result).toEqual({ default: true });
  });

  test("throws on parse error by default", async () => {
    const filePath = join(tempDir, "bad.json");
    await writeFile(filePath, "not json", "utf-8");

    await expect(readJsonFile(filePath, {})).rejects.toThrow();
  });

  test("returns fallback on parse error when onParseError is 'fallback'", async () => {
    const filePath = join(tempDir, "bad.json");
    await writeFile(filePath, "not json", "utf-8");

    const result = await readJsonFile(filePath, { fallback: true }, "fallback");
    expect(result).toEqual({ fallback: true });
  });

  test("throws non-ENOENT errors (e.g. EISDIR)", async () => {
    // Passing a directory path to readFile triggers EISDIR
    await expect(readJsonFile(tempDir, {})).rejects.toThrow();
  });
});

describe("getCacheDir", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_WORKTREE_CACHE_DIR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_WORKTREE_CACHE_DIR = originalEnv;
    } else {
      delete process.env.CLAUDE_WORKTREE_CACHE_DIR;
    }
  });

  test("respects CLAUDE_WORKTREE_CACHE_DIR env var", () => {
    process.env.CLAUDE_WORKTREE_CACHE_DIR = "/tmp/custom-cache";
    expect(getCacheDir()).toBe("/tmp/custom-cache");
  });

  test("falls back to ~/.cache/claude-worktree", () => {
    delete process.env.CLAUDE_WORKTREE_CACHE_DIR;
    const { homedir } = require("node:os");
    expect(getCacheDir()).toBe(join(homedir(), ".cache", "claude-worktree"));
  });
});
