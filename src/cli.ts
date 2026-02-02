import { getGitContext, getWorktreePath, buildWorktreeCommand } from "./git";
import { createPane, sendCommand, sendText } from "./wezterm";
import { buildClaudeCommand } from "./claude";
import { executeClean, type CleanArgs } from "./clean";

export type { CleanArgs } from "./clean";

export interface CreateArgs {
  branchName: string;
  taskName: string;
  prompt: string;
  planFile?: string;
}

export type Command =
  | { type: "create"; args: CreateArgs }
  | { type: "clean"; args: CleanArgs };

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
      default:
        throw new Error(`Unknown option for clean command: ${arg}`);
    }
  }

  return cleanArgs;
}

export function parseArgs(args: string[]): Command {
  if (args.length === 0) {
    throw new Error(
      "Usage: claude-worktree <branch-name> <task-name> [prompt]\n" +
        "       claude-worktree clean [--force] [--all] [--dry-run]\n" +
        "\n" +
        "Commands:\n" +
        "  <branch-name> <task-name>  Create a new worktree with Claude Code\n" +
        "  clean                      Remove unnecessary worktrees\n" +
        "\n" +
        "Clean options:\n" +
        "  -f, --force    Skip confirmation prompt\n" +
        "  -a, --all      Show all worktrees for manual selection\n" +
        "  -n, --dry-run  Show what would be deleted without deleting"
    );
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

export async function run(command: Command): Promise<void> {
  switch (command.type) {
    case "create":
      await runCreate(command.args);
      break;
    case "clean":
      await executeClean(command.args);
      break;
  }
}
