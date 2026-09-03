import type { PermissionMode } from "./claude.ts";
import type { Spinner } from "./spinner.ts";

export type HerdrConfig = {
  label?: string; // Template for the herdr workspace label. Placeholders: {repo}, {branch}. Default: "{repo}/{branch}"
};

export type ProjectConfig = {
  permissionMode?: PermissionMode; // Default permission mode for Claude Code
  maxWorktrees?: number; // Maximum number of concurrent worktrees (excludes main)
  hookTimeout?: number; // Timeout in seconds for all hooks (default: 600)
  postCreate?: string;
  postCreateTimeout?: number; // Timeout in seconds for the postCreate hook
  preClean?: string;
  preCleanTimeout?: number; // Timeout in seconds for the preClean hook
  postClean?: string;
  postCleanTimeout?: number; // Timeout in seconds for the postClean hook
  herdr?: HerdrConfig; // herdr backend settings
};

export const projectConfigFields = {
  permissionMode: String,
  maxWorktrees: Number,
  hookTimeout: Number,
  postCreateTimeout: Number,
  preCleanTimeout: Number,
  postCleanTimeout: Number,
  postCreate: String,
  preClean: String,
  postClean: String,
} satisfies Record<Exclude<keyof Required<ProjectConfig>, "herdr">, typeof Number | typeof String>;

export type HookVars = {
  path: string;
  slot?: number;
};

export type RunHookFn = (
  command: string,
  cwd: string,
  options?: { verbose?: boolean; onLine?: (line: string) => void; timeout?: number },
) => Promise<void>;

/** Options for running a hook against a spinner whose lifecycle the caller owns. */
export type HookRunOptions = {
  hookCmd: string;
  cwd: string;
  verbose: boolean;
  timeout: number;
  /** Spinner to stream hook output into. Ignored when verbose (output goes to stdout instead). */
  spinner?: Spinner | null;
  /** Override the hook runner (dependency injection). Defaults to the core implementation. */
  runHook?: RunHookFn;
};

export type HookExecOptions = {
  hookCmd: string;
  cwd: string;
  label: string;
  verbose: boolean;
  timeout: number;
};

export type HookExecResult = { success: true } | { success: false; message: string };
