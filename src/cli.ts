import { getGitContext, getWorktreePath, buildWorktreeCommand } from "./git";
import { createPane, sendCommand, sendText } from "./wezterm";
import { buildClaudeCommand } from "./claude";
import { executeClean, type CleanArgs } from "./clean";

export type { CleanArgs } from "./clean";

export type CreateArgs = {
  branchName: string;
  taskName: string;
  prompt: string;
  planFile?: string;
  danger?: boolean;
};

export type Command =
  | { type: "help" }
  | { type: "create"; args: CreateArgs }
  | { type: "clean"; args: CleanArgs };

export function showHelp(): void {
  console.log(`claude-worktree - WezTerm + git worktree + Claude Code で並列開発するCLI

Usage:
  claude-worktree <branch-name> <task-name> [prompt]
  claude-worktree <branch-name> <task-name> --plan <file-path>
  claude-worktree clean [options]

Commands:
  <branch-name> <task-name>  Create a new worktree with Claude Code
  clean                      Remove unnecessary worktrees

Arguments:
  <branch-name>  作成するgit worktreeのブランチ名
  <task-name>    タスク名（WezTermタブのタイトルになる）
  [prompt]       Claude Codeに渡すプロンプト（省略時はtask-nameを使用）

Options:
  --plan <file>  プランファイルからプロンプトを読み込む（インラインpromptと併用不可）
  --danger       ワークスペース警告をスキップ（--dangerously-skip-permissions を使用）
  -h, --help     このヘルプを表示

Clean options:
  -f, --force    確認プロンプトをスキップ
  -a, --all      全worktreeを表示して手動選択
  -n, --dry-run  削除せず対象を表示のみ

Examples:
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して'
  claude-worktree fix/bug-123 'バグ修正'
  claude-worktree feature/api 'API実装' --plan ./plan.md
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' --danger
  claude-worktree clean
  claude-worktree clean --dry-run`);
}

function parseCreateArgs(args: string[]): CreateArgs {
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
  let remaining = args.slice(2);

  // --danger フラグを抽出
  const danger = remaining.includes("--danger");
  if (danger) {
    remaining = remaining.filter((arg) => arg !== "--danger");
  }

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
    danger,
  };
}

function parseCleanArgs(args: string[]): CleanArgs {
  const cleanArgs: CleanArgs = {
    force: false,
    all: false,
    dryRun: false,
  };

  for (const arg of args) {
    switch (arg) {
      case "--force":
      case "-f":
        cleanArgs.force = true;
        break;
      case "--all":
      case "-a":
        cleanArgs.all = true;
        break;
      case "--dry-run":
      case "-n":
        cleanArgs.dryRun = true;
        break;
      case "-h":
      case "--help":
        // clean --help は全体ヘルプを表示
        break;
      default:
        throw new Error(`Unknown option for clean command: ${arg}`);
    }
  }

  return cleanArgs;
}

export function parseArgs(args: string[]): Command {
  // ヘルプフラグのチェック
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    return { type: "help" };
  }

  if (args[0] === "clean") {
    return { type: "clean", args: parseCleanArgs(args.slice(1)) };
  }

  return { type: "create", args: parseCreateArgs(args) };
}

// Re-export for backward compatibility
export type CliArgs = CreateArgs;

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

async function runCreate(args: CreateArgs): Promise<void> {
  const { branchName, taskName, planFile, danger } = args;
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
    buildClaudeCommand({ prompt, dangerouslySkipPermissions: danger }),
  ].join(" && ");

  // コマンドを送信
  await sendCommand(paneId, commands);

  // Claude起動後、プロンプト確定のためにEnterを送信
  await Bun.sleep(2000);
  await sendText(paneId, "\n");

  console.log("✅ Worktree created and Claude started in new pane");
}

export async function run(command: Command): Promise<void> {
  switch (command.type) {
    case "help":
      showHelp();
      break;
    case "create":
      await runCreate(command.args);
      break;
    case "clean":
      await executeClean(command.args);
      break;
  }
}
