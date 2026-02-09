import { $ } from "bun";
import { join } from "node:path";

import type { HookVars, ProjectConfig } from "../types";

export async function loadProjectConfig(repoRoot: string): Promise<ProjectConfig | null> {
  const configPath = join(repoRoot, ".claude-worktree.json");
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    return (await file.json()) as ProjectConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  Failed to parse .claude-worktree.json: ${message}`);
    return null;
  }
}

/**
 * Validate template variable values to prevent shell injection.
 * The command template itself is trusted (committed to repo like npm scripts),
 * but dynamic values substituted via {path}/{slot} must be safe.
 */
function validateHookVars(vars: HookVars): void {
  const shellMetachars = /[;&|`$()<>\n\r]/;
  if (shellMetachars.test(vars.path)) {
    throw new Error(`Invalid hook variable: path "${vars.path}" contains shell metacharacters`);
  }
}

export function buildHookCommand(template: string, vars: HookVars): string {
  validateHookVars(vars);
  return template
    .replace(/\{path\}/g, vars.path)
    .replace(/\{slot\}/g, vars.slot !== undefined ? String(vars.slot) : "");
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, command: string): Promise<T> {
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
    const resultPromise = $`${{ raw: command }}`.cwd(cwd).nothrow();
    const result = timeoutMs !== undefined ? await withTimeout(resultPromise, timeoutMs, command) : await resultPromise;
    if (result.exitCode !== 0) {
      throw new Error(`Hook command failed with exit code ${result.exitCode}: ${command}`);
    }
    return;
  }

  if (options?.onLine) {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const readStream = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            options.onLine?.(line);
          }
        }
      }

      // Flush remaining multibyte characters from the decoder
      const remaining = decoder.decode();
      if (remaining) {
        buffer += remaining;
      }

      if (buffer.trim()) {
        options.onLine?.(buffer);
      }
    };

    const streamAndExit = async () => {
      await Promise.all([readStream(proc.stdout), readStream(proc.stderr)]);
      const exitCode = await proc.exited;
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

  const resultPromise = $`${{ raw: command }}`.cwd(cwd).nothrow().quiet();
  const result = timeoutMs !== undefined ? await withTimeout(resultPromise, timeoutMs, command) : await resultPromise;
  if (result.exitCode !== 0) {
    throw new Error(`Hook command failed with exit code ${result.exitCode}: ${command}`);
  }
}
