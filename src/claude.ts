export type ClaudeOptions = {
  permissionMode?: "plan" | "auto-edit" | "full-auto";
  prompt: string;
  promptSuffix?: string;
  dangerouslySkipPermissions?: boolean;
};

const DEFAULT_PROMPT_SUFFIX = "\n\n不明瞭な点は必ずユーザーに確認し、明確にしながら進めてください";

export function buildClaudeCommand(options: ClaudeOptions): string {
  const {
    permissionMode = "plan",
    prompt,
    promptSuffix = DEFAULT_PROMPT_SUFFIX,
    dangerouslySkipPermissions = false,
  } = options;

  const fullPrompt = prompt + promptSuffix;
  const escapedPrompt = fullPrompt.replace(/"/g, '\\"');

  const dangerFlag = dangerouslySkipPermissions ? "--dangerously-skip-permissions " : "";
  return `claude ${dangerFlag}--permission-mode ${permissionMode} "${escapedPrompt}"`;
}
