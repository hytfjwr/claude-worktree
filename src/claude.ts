export type MergeInstructions = {
  baseBranch: string;
  worktreePath: string;
};

export type DraftInstructions = {
  baseBranch: string;
  branchName: string;
};

export type ClaudeOptions = {
  permissionMode?: "plan" | "auto-edit" | "full-auto";
  prompt: string;
  promptSuffix?: string;
  dangerouslySkipPermissions?: boolean;
  mergeInstructions?: MergeInstructions;
  draftInstructions?: DraftInstructions;
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

const DRAFT_INSTRUCTION_TEMPLATE = `

---
## 【重要】タスク完了後の処理

タスクが完了したら、以下の手順を実行してください：

1. **すべての変更をコミット**
   - 変更内容を適切にコミットしてください

2. **リモートへプッシュ**
   - git push -u origin {branchName}

3. **Draft PRを作成**
   - コマンド: gh pr create --draft --base {baseBranch}
   - タイトル: 変更内容を要約した適切なタイトルを生成してください
   - 本文: 現在のディレクトリの.github配下にPRテンプレートがあれば、そのフォーマットに従って記述してください。なければ変更内容のサマリーを記述してください

4. **完了報告**
   - 作成したPRのURLを報告してください`;

function buildMergeInstructions(mergeInstructions: MergeInstructions): string {
  return MERGE_INSTRUCTION_TEMPLATE
    .replace("{baseBranch}", mergeInstructions.baseBranch)
    .replace("{worktreePath}", mergeInstructions.worktreePath);
}

function buildDraftInstructions(draftInstructions: DraftInstructions): string {
  return DRAFT_INSTRUCTION_TEMPLATE
    .replace("{baseBranch}", draftInstructions.baseBranch)
    .replace("{branchName}", draftInstructions.branchName);
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
    draftInstructions,
  } = options;

  let fullPrompt = prompt + promptSuffix;

  if (mergeInstructions) {
    fullPrompt += buildMergeInstructions(mergeInstructions);
  }

  if (draftInstructions) {
    fullPrompt += buildDraftInstructions(draftInstructions);
  }

  const escapedPrompt = escapeForDollarQuote(fullPrompt);

  const dangerFlag = dangerouslySkipPermissions ? "--dangerously-skip-permissions " : "";
  return `claude ${dangerFlag}--permission-mode ${permissionMode} $'${escapedPrompt}'`;
}
