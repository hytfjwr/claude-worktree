import type {
  ClaudeOptions,
  DraftInstructions,
  MergeInstructions,
  PrInstructions,
  ResumeCommandOptions,
} from "../types/index.ts";

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

const PR_INSTRUCTION_TEMPLATE = `

---
## [IMPORTANT] Post-Task Steps

After completing the task, execute the following steps:

1. **Commit all changes**
   - Commit the changes appropriately

2. **Push to remote**
   - git push -u origin {branchName}

3. **Create a PR**
   - Command: gh pr create --base {baseBranch}
   - Title: Generate an appropriate title summarizing the changes
   - Body: If a PR template exists under .github in the current directory, follow that format. Otherwise, write a summary of the changes

4. **Report completion**
   - Report the URL of the created PR`;

/**
 * Single-pass template substitution to avoid double-substitution when
 * a value itself contains a placeholder string (e.g. branch named "{baseBranch}").
 */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

function buildMergeInstructions(mergeInstructions: MergeInstructions): string {
  return fillTemplate(MERGE_INSTRUCTION_TEMPLATE, {
    baseBranch: mergeInstructions.baseBranch,
    worktreePath: mergeInstructions.worktreePath,
  });
}

function buildDraftInstructions(draftInstructions: DraftInstructions): string {
  return fillTemplate(DRAFT_INSTRUCTION_TEMPLATE, {
    baseBranch: draftInstructions.baseBranch,
    branchName: draftInstructions.branchName,
  });
}

function buildPrInstructions(prInstructions: PrInstructions): string {
  return fillTemplate(PR_INSTRUCTION_TEMPLATE, {
    baseBranch: prInstructions.baseBranch,
    branchName: prInstructions.branchName,
  });
}

/**
 * Escape a string for safe use inside shell single quotes.
 * Wraps in single quotes, escaping any embedded single quotes with `'\''`.
 */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function buildResumeCommand(options: ResumeCommandOptions): string {
  const { prompt, dangerouslySkipPermissions = false } = options;

  const dangerFlag = dangerouslySkipPermissions ? " --dangerously-skip-permissions" : "";

  if (!prompt) {
    return `claude --continue${dangerFlag}`;
  }

  return `claude --continue${dangerFlag} -- ${shellEscape(prompt)}`;
}

export function buildClaudeCommand(options: ClaudeOptions): string {
  const {
    permissionMode = "plan",
    prompt,
    promptSuffix = DEFAULT_PROMPT_SUFFIX,
    dangerouslySkipPermissions = false,
    mergeInstructions,
    draftInstructions,
    prInstructions,
  } = options;

  let fullPrompt = prompt + promptSuffix;

  if (mergeInstructions) {
    fullPrompt += buildMergeInstructions(mergeInstructions);
  }

  if (draftInstructions) {
    fullPrompt += buildDraftInstructions(draftInstructions);
  }

  if (prInstructions) {
    fullPrompt += buildPrInstructions(prInstructions);
  }

  const dangerFlag = dangerouslySkipPermissions ? "--dangerously-skip-permissions " : "";

  return `claude ${dangerFlag}--permission-mode ${permissionMode} -- ${shellEscape(fullPrompt)}`;
}
