import { $ } from "bun";
import { join } from "node:path";

import type { HookVars, ProjectConfig } from "./types";

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

export async function runHook(
  command: string,
  cwd: string,
  options?: { verbose?: boolean; onLine?: (line: string) => void },
): Promise<void> {
  if (options?.verbose) {
    const result = await $`${{ raw: command }}`.cwd(cwd).nothrow();
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

    await Promise.all([readStream(proc.stdout), readStream(proc.stderr)]);

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Hook command failed with exit code ${exitCode}: ${command}`);
    }
    return;
  }

  const result = await $`${{ raw: command }}`.cwd(cwd).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error(`Hook command failed with exit code ${result.exitCode}: ${command}`);
  }
}
