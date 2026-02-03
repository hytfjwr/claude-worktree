export type MergeInstructions = {
  baseBranch: string;
  worktreePath: string;
};

export type ClaudeOptions = {
  permissionMode?: "plan" | "auto-edit" | "full-auto";
  prompt: string;
  promptSuffix?: string;
  dangerouslySkipPermissions?: boolean;
  mergeInstructions?: MergeInstructions;
};

const DEFAULT_PROMPT_SUFFIX = "\n\n不明瞭な点は必ずユーザーに確認し、明確にしながら進めてください";

const MERGE_INSTRUCTION_TEMPLATE = `

---
## 【重要】タスク完了後の処理

タスクが完了したら、以下の手順を実行してください：

1. **すべての変更をコミット**
2. **ベースブランチへマージ**
   - マージ対象: {baseBranch}
   - コンフリクト発生時は解決してください
3. **クリーンアップ**
   - worktree削除: git worktree remove "{worktreePath}"
   - ブランチ削除: git branch -d <merged-branch>
4. **完了報告**`;

function buildMergeInstructions(mergeInstructions: MergeInstructions): string {
  return MERGE_INSTRUCTION_TEMPLATE
    .replace("{baseBranch}", mergeInstructions.baseBranch)
    .replace("{worktreePath}", mergeInstructions.worktreePath);
}

/**
 * シェルの $'...' 形式用にプロンプトをエスケープする
 * $'...' 形式では \n, \t などのエスケープシーケンスが解釈される
 */
function escapeForDollarQuote(str: string): string {
  return str
    .replace(/\\/g, '\\\\')    // バックスラッシュを先にエスケープ
    .replace(/'/g, "\\'")      // シングルクォートをエスケープ
    .replace(/\n/g, '\\n')     // 改行をリテラル \n に
    .replace(/\r/g, '\\r')     // キャリッジリターンをエスケープ
    .replace(/\t/g, '\\t');    // タブをエスケープ
}

export function buildClaudeCommand(options: ClaudeOptions): string {
  const {
    permissionMode = "plan",
    prompt,
    promptSuffix = DEFAULT_PROMPT_SUFFIX,
    dangerouslySkipPermissions = false,
    mergeInstructions,
  } = options;

  let fullPrompt = prompt + promptSuffix;

  if (mergeInstructions) {
    fullPrompt += buildMergeInstructions(mergeInstructions);
  }

  const escapedPrompt = escapeForDollarQuote(fullPrompt);

  const dangerFlag = dangerouslySkipPermissions ? "--dangerously-skip-permissions " : "";
  return `claude ${dangerFlag}--permission-mode ${permissionMode} $'${escapedPrompt}'`;
}
