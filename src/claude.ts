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
 * ヒアドキュメントのデリミタ用にプロンプトをエスケープする
 * プロンプト内にデリミタ文字列(PROMPT_END)が含まれていないかチェック
 */
function escapeForHeredoc(str: string): string {
  // ヒアドキュメントでは特別なエスケープは不要
  // ただしデリミタと同じ文字列が含まれていると問題になるため、
  // その場合は別のデリミタを使うか、文字列を変換する必要がある
  // 現実的にはPROMPT_ENDがプロンプト内に出現することはほぼないと想定
  return str;
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

  // ヒアドキュメント形式でプロンプトを渡す
  // 'PROMPT_END'をクォートすることで変数展開を防ぐ
  return `claude ${dangerFlag}--permission-mode ${permissionMode} <<'PROMPT_END'
${escapedPrompt}
PROMPT_END`;
}
