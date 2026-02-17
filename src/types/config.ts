import type { PermissionMode } from "./claude.ts";

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
} satisfies Record<keyof Required<ProjectConfig>, typeof Number | typeof String>;

export type HookVars = {
  path: string;
  slot?: number;
};

export type HookExecOptions = {
  hookCmd: string;
  cwd: string;
  label: string;
  verbose: boolean;
  timeout: number;
};

export type HookExecResult = { success: true } | { success: false; message: string };
