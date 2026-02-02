import { getGitContext, getWorktreePath, buildWorktreeCommand } from "./git";
import { createPane, sendCommand, sendText } from "./wezterm";
import { buildClaudeCommand } from "./claude";

export interface CliArgs {
  branchName: string;
  taskName: string;
  prompt: string;
  planFile?: string;
}

export function parseArgs(args: string[]): CliArgs {
  if (args.length < 2) {
    throw new Error(
      "Usage: claude-worktree <branch-name> <task-name> [prompt]\n" +
        "       claude-worktree <branch-name> <task-name> --plan <file-path>\n" +
        "Example: claude-worktree feature/auth 'Auth実装' '認証機能を実装して'\n" +
        "         claude-worktree feature/auth 'Auth実装' --plan ./plan.md"
    );
  }

  const branchName = args[0];
  const taskName = args[1];
  const remaining = args.slice(2);

  // --plan オプションを抽出
  const planIndex = remaining.indexOf("--plan");
  let planFile: string | undefined;
  let inlinePromptParts: string[] = [];

  if (planIndex !== -1) {
    if (planIndex + 1 >= remaining.length) {
      throw new Error("--plan requires a file path argument");
    }
    planFile = remaining[planIndex + 1];
    // --plan とそのパスを除いた残りをインラインプロンプトとする
    inlinePromptParts = [
      ...remaining.slice(0, planIndex),
      ...remaining.slice(planIndex + 2),
    ];
  } else {
    inlinePromptParts = remaining;
  }

  const inlinePrompt = inlinePromptParts.join(" ");

  // 排他性チェック: --plan とインラインプロンプトの両方は指定不可
  if (planFile && inlinePrompt) {
    throw new Error(
      "Cannot use both --plan and inline prompt. Please use one or the other."
    );
  }

  return {
    branchName,
    taskName,
    prompt: inlinePrompt || taskName,
    planFile,
  };
}

async function readPlanFile(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(`Plan file not found: ${filePath}`);
  }

  const content = await file.text();
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(`Plan file is empty: ${filePath}`);
  }

  return trimmed;
}

export async function run(args: CliArgs): Promise<void> {
  const { branchName, taskName, planFile } = args;
  let { prompt } = args;

  // プランファイルからプロンプトを読み込み
  if (planFile) {
    prompt = await readPlanFile(planFile);
  }

  // Git情報を取得
  const git = await getGitContext();
  const worktreePath = getWorktreePath(git.repoRoot, git.repoName, branchName);

  console.log(`📍 Current branch: ${git.currentBranch}`);
  console.log(`🌿 New branch: ${branchName}`);
  console.log(`📂 Worktree path: ${worktreePath}`);
  console.log(`📝 Task: ${taskName}`);
  if (planFile) {
    console.log(`📋 Plan file: ${planFile}`);
  }

  // WezTermペインを作成
  const paneId = await createPane({ title: taskName, keepFocus: true });
  console.log(`🪟 Created pane: ${paneId}`);

  // 実行コマンドを構築
  const commands = [
    buildWorktreeCommand(branchName, worktreePath, git.currentBranch),
    `cd "${worktreePath}"`,
    `[ -f package.json ] && bun install || true`,
    buildClaudeCommand({ prompt }),
  ].join(" && ");

  // コマンドを送信
  await sendCommand(paneId, commands);

  // Claude起動後、プロンプト確定のためにEnterを送信
  await Bun.sleep(2000);
  await sendText(paneId, "\n");

  console.log("✅ Worktree created and Claude started in new pane");
}
