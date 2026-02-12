import type { ClaudeOptions, DraftInstructions, MergeInstructions, ResumeCommandOptions } from "../types.ts";

const DEFAULT_PROMPT_SUFFIX = "\n\nIf anything is unclear, always confirm with the user before proceeding.";

const MERGE_INSTRUCTION_TEMPLATE = `

---
## [IMPORTANT] Post-Task Steps

After completing the task, execute the following steps:

1. **Commit all changes**
2. **Merge into the base branch**
   - Merge target: {baseBranch}
   - Resolve any conflicts if they occur
3. **Cleanup**
   - Remove worktree: git worktree remove "{worktreePath}"
   - Delete branch: git branch -d <merged-branch>
4. **Report completion**`;

const DRAFT_INSTRUCTION_TEMPLATE = `

---
## [IMPORTANT] Post-Task Steps

After completing the task, execute the following steps:

1. **Commit all changes**
   - Commit the changes appropriately

2. **Push to remote**
   - git push -u origin {branchName}

3. **Create a Draft PR**
   - Command: gh pr create --draft --base {baseBranch}
   - Title: Generate an appropriate title summarizing the changes
   - Body: If a PR template exists under .github in the current directory, follow that format. Otherwise, write a summary of the changes

4. **Report completion**
   - Report the URL of the created PR`;

function buildMergeInstructions(mergeInstructions: MergeInstructions): string {
  return MERGE_INSTRUCTION_TEMPLATE.replace("{baseBranch}", mergeInstructions.baseBranch).replace(
    "{worktreePath}",
    mergeInstructions.worktreePath,
  );
}

function buildDraftInstructions(draftInstructions: DraftInstructions): string {
  return DRAFT_INSTRUCTION_TEMPLATE.replace("{baseBranch}", draftInstructions.baseBranch).replace(
    "{branchName}",
    draftInstructions.branchName,
  );
}

/**
 * Escape prompt for heredoc delimiter.
 * Check that the delimiter string (PROMPT_END) does not appear in the prompt.
 */
function escapeForHeredoc(str: string): string {
  // No special escaping is needed for heredoc.
  // However, if the delimiter string appears in the content, a different delimiter
  // or string transformation would be needed.
  // In practice, PROMPT_END is unlikely to appear in a prompt.
  return str;
}

export function buildResumeCommand(options: ResumeCommandOptions): string {
  const { prompt, dangerouslySkipPermissions = false } = options;

  const dangerFlag = dangerouslySkipPermissions ? " --dangerously-skip-permissions" : "";

  if (!prompt) {
    return `claude --continue${dangerFlag}`;
  }

  const escapedPrompt = escapeForHeredoc(prompt);
  return `claude --continue${dangerFlag} <<'PROMPT_END'
${escapedPrompt}
PROMPT_END`;
}

export function buildClaudeCommand(options: ClaudeOptions): string {
  const {
    permissionMode = "plan",
    prompt,
    promptSuffix = DEFAULT_PROMPT_SUFFIX,
    dangerouslySkipPermissions = false,
    mergeInstructions,
    draftInstructions,
  } = options;

  let fullPrompt = prompt + promptSuffix;

  if (mergeInstructions) {
    fullPrompt += buildMergeInstructions(mergeInstructions);
  }

  if (draftInstructions) {
    fullPrompt += buildDraftInstructions(draftInstructions);
  }

  const escapedPrompt = escapeForHeredoc(fullPrompt);

  const dangerFlag = dangerouslySkipPermissions ? "--dangerously-skip-permissions " : "";

  // Pass the prompt via heredoc format.
  // Quoting 'PROMPT_END' prevents variable expansion.
  return `claude ${dangerFlag}--permission-mode ${permissionMode} <<'PROMPT_END'
${escapedPrompt}
PROMPT_END`;
}
