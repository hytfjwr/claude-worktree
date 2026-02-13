import type { CleanArgs } from "./clean.ts";
import type { ListArgs } from "./list.ts";

export type CreateArgs = {
  branchName: string;
  prompt: string;
  planFile?: string;
  danger?: boolean;
  merge?: boolean;
  draft?: boolean;
  baseBranch?: string;
  pull?: boolean;
  pane?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
};

export type ResumeArgs = {
  branchName?: string;
  prompt?: string;
  danger?: boolean;
  pane?: boolean;
  verbose?: boolean;
};

export type RunInPaneArgs = {
  worktreePath: string;
  repoRoot: string;
  claudeCommand: string;
  postCreateCommand?: string;
  postCreateTimeout: number;
  preCleanCommand?: string;
  preCleanTimeout: number;
  postCleanCommand?: string;
  postCleanTimeout: number;
  slot?: number;
  verbose: boolean;
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
