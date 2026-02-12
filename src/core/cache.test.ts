import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resetLogger, setLogger } from "../ui/logger.ts";
import { atomicWriteJson, readJsonFile, withLock } from "./cache.ts";

describe("withLock", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cache-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    resetLogger();
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

  test("warns and proceeds without lock when lock is held", async () => {
    const lockFile = join(tempDir, "held.lock");
    await writeFile(lockFile, "held", "utf-8");

    const warnings: string[] = [];
    setLogger({
      log: () => {},
      warn: (msg) => warnings.push(msg),
      error: () => {},
      debug: () => {},
    });

    const result = await withLock(lockFile, async () => "still works", { maxRetries: 2, retryIntervalMs: 1 });
    expect(result).toBe("still works");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Lock acquisition failed for held.lock");
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
});
