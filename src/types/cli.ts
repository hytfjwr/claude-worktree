import type { CleanArgs } from "./clean.ts";
import type { ListArgs } from "./list.ts";

export type CreateArgs = {
  branchName: string;
  prompt: string;
  planFile?: string;
  danger?: boolean;
  merge?: boolean;
  draft?: boolean;
  pr?: boolean;
  baseBranch?: string;
  model?: string;
  pull?: boolean;
  pane?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
};

export type ResumeArgs = {
  branchName?: string;
  prompt?: string;
  danger?: boolean;
  model?: string;
  pane?: boolean;
  verbose?: boolean;
  quiet?: boolean;
};

export type RunInPaneArgs = {
  worktreePath: string;
  repoRoot: string;
  /** Branch name created by `git worktree add -b`, deleted on rollback */
  branchName: string;
  claudeCommand: string;
  postCreateCommand?: string;
  postCreateTimeout: number;
  preCleanCommand?: string;
  preCleanTimeout: number;
  postCleanCommand?: string;
  postCleanTimeout: number;
  slot?: number;
  verbose: boolean;
  quiet: boolean;
};

export type Command =
  | { type: "help"; commandHelp?: "create" | "list" | "clean" | "resume" }
  | { type: "version" }
  | { type: "create"; args: CreateArgs }
  | { type: "resume"; args: ResumeArgs }
  | { type: "clean"; args: CleanArgs }
  | { type: "list"; args: ListArgs }
  | { type: "_run-in-pane"; payloadPath: string };

// Re-export for backward compatibility
export type CliArgs = CreateArgs;
