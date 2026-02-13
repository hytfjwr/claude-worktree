import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";

import type { HookVars, ProjectConfig } from "../types/index.ts";
import { projectConfigFields } from "../types/index.ts";
import { logWarn } from "../ui/logger.ts";
import { getErrorMessage, isNodeError } from "./errors.ts";
import { exec } from "./exec.ts";

function checkField(field: string, value: unknown, expected: typeof Number | typeof String): string | null {
  if (expected === Number) {
    if (field === "maxWorktrees") {
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        return `${field} must be a non-negative integer, got ${JSON.stringify(value)}`;
      }
    } else {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return `${field} must be a positive number, got ${JSON.stringify(value)}`;
      }
    }
  } else if (expected === String) {
    if (typeof value !== "string") {
      return `${field} must be a string, got ${JSON.stringify(value)}`;
    }
  }
  return null;
}

export function validateProjectConfig(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["Config must be a JSON object"];
  }

  const obj = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const [field, expected] of Object.entries(projectConfigFields)) {
    if (obj[field] !== undefined) {
      const error = checkField(field, obj[field], expected);
      if (error) errors.push(error);
    }
  }

  return errors;
}

export async function loadProjectConfig(repoRoot: string): Promise<ProjectConfig | null> {
  const configPath = join(repoRoot, ".claude-worktree.json");

  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = getErrorMessage(error);
    logWarn(`Failed to parse .claude-worktree.json: ${message}`);
    return null;
  }

  const errors = validateProjectConfig(parsed);
  if (errors.length > 0) {
    for (const error of errors) {
      logWarn(`Invalid .claude-worktree.json: ${error}`);
    }
    return null;
  }

  return parsed as ProjectConfig;
}

/**
 * Validate template variable values to prevent shell injection.
 * The command template itself is trusted (committed to repo like npm scripts),
 * but dynamic values substituted via {path}/{slot} must be safe.
 */
function validateHookVars(vars: HookVars): void {
  if (vars.path.length === 0) {
    throw new Error("Invalid path in hook variables. Path must not be empty.");
  }
  const SAFE_PATH = /^[a-zA-Z0-9._/-]+$/;
  if (!SAFE_PATH.test(vars.path)) {
    throw new Error(
      `Invalid path in hook variables: ${JSON.stringify(vars.path)}. Only alphanumeric, dots, underscores, slashes, and hyphens are allowed.`,
    );
  }
  if (vars.path.startsWith("-")) {
    throw new Error(
      "Invalid path in hook variables. Path must not start with '-' to avoid being interpreted as a command-line option.",
    );
  }
  if (vars.slot != null && (!Number.isInteger(vars.slot) || vars.slot < 1 || vars.slot > 9)) {
    throw new Error("Invalid slot: must be an integer between 1-9");
  }
}

export function buildHookCommand(template: string, vars: HookVars): string {
  validateHookVars(vars);
  return template.replace(/\{path\}/g, vars.path).replace(/\{slot\}/g, vars.slot != null ? String(vars.slot) : "");
}

export const DEFAULT_HOOK_TIMEOUT = 600;

export function resolveHookTimeout(
  hookName: "postCreate" | "preClean" | "postClean",
  config: ProjectConfig | null,
): number {
  if (hookName === "postCreate" && config?.postCreateTimeout !== undefined) {
    return config.postCreateTimeout;
  }
  if (hookName === "preClean" && config?.preCleanTimeout !== undefined) {
    return config.preCleanTimeout;
  }
  if (hookName === "postClean" && config?.postCleanTimeout !== undefined) {
    return config.postCleanTimeout;
  }
  return config?.hookTimeout ?? DEFAULT_HOOK_TIMEOUT;
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, command: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Hook command timed out after ${timeoutMs / 1000}s: ${command}`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function runHook(
  command: string,
  cwd: string,
  options?: { verbose?: boolean; onLine?: (line: string) => void; timeout?: number },
): Promise<void> {
  const timeoutMs = options?.timeout !== undefined ? options.timeout * 1000 : undefined;

  if (options?.verbose) {
    const resultPromise = exec("sh", ["-c", command]).cwd(cwd).nothrow();
    const result = timeoutMs !== undefined ? await withTimeout(resultPromise, timeoutMs, command) : await resultPromise;
    if (result.exitCode !== 0) {
      throw new Error(`Hook command failed with exit code ${result.exitCode}: ${command}`);
    }
    return;
  }

  if (options?.onLine) {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const readStream = (stream: NodeJS.ReadableStream) => {
      return new Promise<void>((resolve, reject) => {
        const decoder = new TextDecoder();
        let buffer = "";

        stream.on("data", (chunk: Buffer) => {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              options.onLine?.(line);
            }
          }
        });

        stream.on("error", reject);

        stream.on("end", () => {
          // Flush remaining multibyte characters from the decoder
          const remaining = decoder.decode();
          if (remaining) {
            buffer += remaining;
          }

          if (buffer.trim()) {
            options.onLine?.(buffer);
          }
          resolve();
        });
      });
    };

    const streamAndExit = async () => {
      const exitPromise = new Promise<number>((resolve, reject) => {
        proc.on("error", reject);
        proc.on("close", (code) => resolve(code ?? 1));
      });

      const readPromises: Promise<void>[] = [];
      if (proc.stdout) {
        readPromises.push(readStream(proc.stdout));
      }
      if (proc.stderr) {
        readPromises.push(readStream(proc.stderr));
      }

      let exitCode: number;
      try {
        const results = await Promise.all([exitPromise, ...readPromises]);
        exitCode = results[0];
      } catch (error) {
        // Kill the process if a stream error occurs and process is still alive
        try {
          if (!proc.killed) {
            proc.kill();
          }
        } catch {
          // Process may already be dead (ESRCH)
        }
        throw error;
      }
      if (exitCode !== 0) {
        throw new Error(`Hook command failed with exit code ${exitCode}: ${command}`);
      }
    };

    if (timeoutMs !== undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          streamAndExit(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              proc.kill();
              reject(new Error(`Hook command timed out after ${timeoutMs / 1000}s: ${command}`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    } else {
      await streamAndExit();
    }
    return;
  }

  const resultPromise = exec("sh", ["-c", command]).cwd(cwd).nothrow().quiet();
  const result = timeoutMs !== undefined ? await withTimeout(resultPromise, timeoutMs, command) : await resultPromise;
  if (result.exitCode !== 0) {
    throw new Error(`Hook command failed with exit code ${result.exitCode}: ${command}`);
  }
}
