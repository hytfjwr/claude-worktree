import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";

import { logWarn } from "../ui/logger.ts";
import { isNodeError } from "./errors.ts";

export const LOCK_MAX_RETRIES = 50;
export const LOCK_RETRY_INTERVAL_MS = 100;

export interface LockOptions {
  maxRetries?: number;
  retryIntervalMs?: number;
}

export async function withLock<T>(lockFile: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? LOCK_MAX_RETRIES;
  const retryIntervalMs = options?.retryIntervalMs ?? LOCK_RETRY_INTERVAL_MS;

  await mkdir(dirname(lockFile), { recursive: true });

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      handle = await open(lockFile, "wx");
      break;
    } catch {
      await setTimeout(retryIntervalMs);
    }
  }

  if (!handle) {
    const name = lockFile.split("/").pop() ?? lockFile;
    logWarn(`Lock acquisition failed for ${name}, proceeding without lock`);
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

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tempFile = `${filePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), "utf-8");
  await rename(tempFile, filePath);
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: T,
  onParseError: "throw" | "fallback" = "throw",
): Promise<T> {
  let data: string;
  try {
    data = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return fallback;
    }
    throw err;
  }

  try {
    return JSON.parse(data) as T;
  } catch (err: unknown) {
    if (onParseError === "fallback") {
      return fallback;
    }
    throw err;
  }
}
