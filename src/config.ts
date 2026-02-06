import { $ } from "bun";
import { join } from "path";

export type ProjectConfig = {
  postCreate?: string;
  preClean?: string;
};

export type HookVars = {
  path: string;
  slot?: number;
};

export async function loadProjectConfig(
  repoRoot: string
): Promise<ProjectConfig | null> {
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
    throw new Error(
      `Invalid hook variable: path "${vars.path}" contains shell metacharacters`
    );
  }
}

export function buildHookCommand(template: string, vars: HookVars): string {
  validateHookVars(vars);
  return template
    .replace(/\{path\}/g, vars.path)
    .replace(
      /\{slot\}/g,
      vars.slot !== undefined ? String(vars.slot) : ""
    );
}

export async function runHook(command: string, cwd: string): Promise<void> {
  const result = await $`${{ raw: command }}`.cwd(cwd).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Hook command failed with exit code ${result.exitCode}: ${command}`
    );
  }
}
