import {
  getGitContext,
  getWorktreePath,
  buildWorktreeCommand,
  findWorktreeByBranch,
  removeWorktree,
  deleteLocalBranch,
  branchExists,
} from "./git";
import { createPane, sendCommand, sendText } from "./wezterm";
import { buildClaudeCommand } from "./claude";
import { executeClean, type CleanArgs } from "./clean";
import { confirm } from "./prompt";

export type { CleanArgs } from "./clean";

export type CreateArgs = {
  branchName: string;
  taskName: string;
  prompt: string;
  planFile?: string;
  danger?: boolean;
  merge?: boolean;
  baseBranch?: string;
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
  --plan <file>    プランファイルからプロンプトを読み込む（インラインpromptと併用不可）
  --base <branch>  ベースブランチを指定（デフォルト: 現在のブランチ）
  --danger         ワークスペース警告をスキップ（--dangerously-skip-permissions を使用）
  --merge          タスク完了後に元ブランチへ自動マージ・クリーンアップ
  -h, --help       このヘルプを表示

Clean options:
  -f, --force    確認プロンプトをスキップ
  -a, --all      全worktreeを表示して手動選択
  -n, --dry-run  削除せず対象を表示のみ

Examples:
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して'
  claude-worktree fix/bug-123 'バグ修正'
  claude-worktree feature/api 'API実装' --plan ./plan.md
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' --danger
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' --merge
  claude-worktree clean
  claude-worktree clean --dry-run`);
}

export function parseCreateArgs(args: string[]): CreateArgs {
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

  // --merge フラグを抽出
  const merge = remaining.includes("--merge");
  if (merge) {
    remaining = remaining.filter((arg) => arg !== "--merge");
  }

  // --base オプションを抽出
  const baseIndex = remaining.indexOf("--base");
  let baseBranch: string | undefined;

  if (baseIndex !== -1) {
    if (baseIndex + 1 >= remaining.length) {
      throw new Error("--base requires a branch name argument");
    }
    baseBranch = remaining[baseIndex + 1];
    remaining = [
      ...remaining.slice(0, baseIndex),
      ...remaining.slice(baseIndex + 2),
    ];
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
    merge,
    baseBranch,
  };
}

export function parseCleanArgs(args: string[]): CleanArgs {
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

export type CreateDependencies = {
  getGitContext: typeof getGitContext;
  getWorktreePath: typeof getWorktreePath;
  findWorktreeByBranch: typeof findWorktreeByBranch;
  removeWorktree: typeof removeWorktree;
  deleteLocalBranch: typeof deleteLocalBranch;
  branchExists: typeof branchExists;
  createPane: typeof createPane;
  sendCommand: typeof sendCommand;
  sendText: typeof sendText;
  buildWorktreeCommand: typeof buildWorktreeCommand;
  buildClaudeCommand: typeof buildClaudeCommand;
  confirm: typeof confirm;
  log: typeof console.log;
  readPlanFile: (path: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
};

const defaultCreateDependencies: CreateDependencies = {
  getGitContext,
  getWorktreePath,
  findWorktreeByBranch,
  removeWorktree,
  deleteLocalBranch,
  branchExists,
  createPane,
  sendCommand,
  sendText,
  buildWorktreeCommand,
  buildClaudeCommand,
  confirm,
  log: console.log,
  readPlanFile,
  sleep: Bun.sleep,
};

export async function runCreate(
  args: CreateArgs,
  deps: CreateDependencies = defaultCreateDependencies
): Promise<void> {
  const { branchName, taskName, planFile, danger, merge, baseBranch } = args;
  let { prompt } = args;

  // プランファイルからプロンプトを読み込み
  if (planFile) {
    prompt = await deps.readPlanFile(planFile);
  }

  // Git情報を取得
  const git = await deps.getGitContext();
  const worktreePath = deps.getWorktreePath(git.repoRoot, git.repoName, branchName);

  // baseBranch が指定されていれば使用、なければ現在のブランチ
  const effectiveBaseBranch = baseBranch ?? git.currentBranch;

  deps.log(`📍 Current branch: ${git.currentBranch}`);
  if (baseBranch) {
    deps.log(`🌳 Base branch: ${baseBranch}`);
  }
  deps.log(`🌿 New branch: ${branchName}`);
  deps.log(`📂 Worktree path: ${worktreePath}`);
  deps.log(`📝 Task: ${taskName}`);
  if (planFile) {
    deps.log(`📋 Plan file: ${planFile}`);
  }
  if (merge) {
    deps.log(`🔀 Auto-merge to: ${git.currentBranch}`);
  }

  // 既存ワークツリーの重複チェック
  const existingWorktree = await deps.findWorktreeByBranch(branchName);

  if (existingWorktree) {
    deps.log(`\n⚠️  Worktree already exists: ${existingWorktree.path}`);

    let confirmed: boolean;
    if (existingWorktree.isDirty) {
      deps.log("⚠️  警告: 未コミットの変更があります");
      confirmed = await deps.confirm(
        "変更を破棄してworktreeを削除しますか？"
      );
    } else {
      confirmed = await deps.confirm(
        "既存のworktreeを削除して新しいセッションを開始しますか？"
      );
    }

    if (!confirmed) {
      deps.log("キャンセルしました。");
      return;
    }

    // 既存ワークツリーとブランチを削除
    deps.log("🗑️  既存のworktreeを削除中...");
    await deps.removeWorktree(existingWorktree.path, existingWorktree.isDirty);
    deps.log(`  ✓ Worktree deleted: ${existingWorktree.path}`);

    try {
      await deps.deleteLocalBranch(branchName, true);
      deps.log(`  ✓ Branch deleted: ${branchName}`);
    } catch {
      // ブランチが存在しない場合は無視
      deps.log(`  ⚠️  Branch not found (skipping): ${branchName}`);
    }

    deps.log("");
  }

  // ブランチのみ存在（ワークツリーなし）のチェック
  if (!existingWorktree) {
    const branchAlreadyExists = await deps.branchExists(branchName);

    if (branchAlreadyExists) {
      deps.log(`\n⚠️  ブランチが既に存在します: ${branchName}`);

      const confirmed = await deps.confirm(
        "ブランチを削除して新規作成しますか？"
      );

      if (!confirmed) {
        deps.log("キャンセルしました。");
        return;
      }

      deps.log("🗑️  既存のブランチを削除中...");
      try {
        await deps.deleteLocalBranch(branchName, true);
        deps.log(`  ✓ Branch deleted: ${branchName}`);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        deps.log(`  ❌ ブランチの削除に失敗しました: ${errorMessage}`);
        return;
      }
      deps.log("");
    }
  }

  // WezTermペインを作成
  const paneId = await deps.createPane({ title: taskName, keepFocus: true });
  deps.log(`🪟 Created pane: ${paneId}`);

  // 実行コマンドを構築
  const claudeOptions = {
    prompt,
    dangerouslySkipPermissions: danger,
    ...(merge && {
      mergeInstructions: {
        baseBranch: git.currentBranch,
        worktreePath,
      },
    }),
  };

  const commands = [
    deps.buildWorktreeCommand(branchName, worktreePath, effectiveBaseBranch),
    `cd "${worktreePath}"`,
    deps.buildClaudeCommand(claudeOptions),
  ].join(" && ");

  // コマンドを送信
  await deps.sendCommand(paneId, commands);

  // Claude起動後、プロンプト確定のためにEnterを送信
  await deps.sleep(2000);
  await deps.sendText(paneId, "\n");

  deps.log("✅ Worktree created and Claude started in new pane");
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
