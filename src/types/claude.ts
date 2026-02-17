export type MergeInstructions = {
  baseBranch: string;
  worktreePath: string;
};

export type DraftInstructions = {
  baseBranch: string;
  branchName: string;
};

export type PrInstructions = {
  baseBranch: string;
  branchName: string;
};

export type PermissionMode = "plan" | "auto-edit" | "full-auto";

export const VALID_PERMISSION_MODES: readonly PermissionMode[] = ["plan", "auto-edit", "full-auto"];

export type ClaudeOptions = {
  permissionMode?: PermissionMode;
  prompt: string;
  promptSuffix?: string;
  dangerouslySkipPermissions?: boolean;
  mergeInstructions?: MergeInstructions;
  draftInstructions?: DraftInstructions;
  prInstructions?: PrInstructions;
};

export type ResumeCommandOptions = {
  prompt?: string;
  dangerouslySkipPermissions?: boolean;
};
