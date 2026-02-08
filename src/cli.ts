import {
  getGitContext,
  getWorktreePath,
  createWorktree,
  findWorktreeByBranch,
  removeWorktree,
  deleteLocalBranch,
  branchExists,
} from "./git";
import { createPane, sendCommand, sendText } from "./wezterm";
import { buildClaudeCommand } from "./claude";
import { executeClean, type CleanArgs } from "./clean";
import { confirm } from "./prompt";
import { loadProjectConfig, buildHookCommand, runHook } from "./config";
import { findAvailableSlot } from "./slot";
import { extractOptions } from "./options";
import { startSpinner } from "./spinner";

export type { CleanArgs } from "./clean";

export type CreateArgs = {
  branchName: string;
  taskName: string;
  prompt: string;
  planFile?: string;
  danger?: boolean;
  merge?: boolean;
  draft?: boolean;
  baseBranch?: string;
  pane?: boolean;
  verbose?: boolean;
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
  -p, --pane       WezTermの新しいペインで開く（デフォルト: 現在のターミナルで実行）
  --plan <file>    プランファイルからプロンプトを読み込む（インラインpromptと併用不可）
  --base <branch>  ベースブランチを指定（デフォルト: 現在のブランチ）
  --danger         ワークスペース警告をスキップ（--dangerously-skip-permissions を使用）
  --merge          タスク完了後に元ブランチへ自動マージ・クリーンアップ
  --draft          タスク完了後にDraft PRを自動作成（--mergeと併用不可）
  -v, --verbose    フック実行時のログを表示
  -h, --help       このヘルプを表示

Clean options:
  -f, --force    確認プロンプトをスキップ
  -a, --all      全worktreeを表示して手動選択
  -n, --dry-run  削除せず対象を表示のみ
  -v, --verbose  フック実行時のログを表示

Examples:
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して'
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' -p
  claude-worktree fix/bug-123 'バグ修正' --pane
  claude-worktree feature/api 'API実装' --plan ./plan.md
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' --danger
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' --merge
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' --draft
  claude-worktree feature/auth 'Auth実装' '認証機能を実装して' --draft --base main
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

  const { booleans, strings, remaining } = extractOptions(args.slice(2), {
    options: {
      pane:    { type: "boolean", flag: "--pane", alias: "-p" },
      danger:  { type: "boolean", flag: "--danger" },
      merge:   { type: "boolean", flag: "--merge" },
      draft:   { type: "boolean", flag: "--draft" },
      verbose: { type: "boolean", flag: "--verbose", alias: "-v" },
      baseBranch: { type: "string", flag: "--base", errorMessage: "--base requires a branch name argument" },
      planFile:   { type: "string", flag: "--plan", errorMessage: "--plan requires a file path argument" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "--help"],
    unknownErrorPrefix: "Unknown option",
  });

  const { pane, danger, merge, draft, verbose } = booleans;
  const { baseBranch, planFile } = strings;

  // --merge と --draft の排他性チェック
  if (merge && draft) {
    throw new Error(
      "Cannot use both --merge and --draft options. Please use one or the other."
    );
  }

  const inlinePrompt = remaining.join(" ");

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
    draft,
    baseBranch,
    pane,
    verbose,
  };
}

export function parseCleanArgs(args: string[]): CleanArgs {
  const { booleans } = extractOptions(args, {
    options: {
      force:   { type: "boolean", flag: "--force", alias: "-f" },
      all:     { type: "boolean", flag: "--all",   alias: "-a" },
      dryRun:  { type: "boolean", flag: "--dry-run", alias: "-n" },
      verbose: { type: "boolean", flag: "--verbose", alias: "-v" },
    },
    unknownHandling: "error",
    ignoredFlags: ["-h", "--help"],
    unknownErrorPrefix: "Unknown option for clean command",
  });

  return {
    force: booleans.force,
    all: booleans.all,
    dryRun: booleans.dryRun,
    verbose: booleans.verbose,
  };
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

export async function runCreate(args: CreateArgs): Promise<void> {
  const { branchName, taskName, planFile, danger, merge, draft, baseBranch, pane } = args;
  let { prompt } = args;

  // プランファイルからプロンプトを読み込み
  if (planFile) {
    prompt = await readPlanFile(planFile);
  }

  // Git情報を取得
  const git = await getGitContext();
  const worktreePath = getWorktreePath(git.repoRoot, git.repoName, branchName);

  // baseBranch が指定されていれば使用、なければ現在のブランチ
  const effectiveBaseBranch = baseBranch ?? git.currentBranch;

  const config = await loadProjectConfig(git.repoRoot);

  console.log(`📍 Current branch: ${git.currentBranch}`);
  if (baseBranch) {
    console.log(`🌳 Base branch: ${baseBranch}`);
  }
  console.log(`🌿 New branch: ${branchName}`);
  console.log(`📂 Worktree path: ${worktreePath}`);
  console.log(`📝 Task: ${taskName}`);
  if (planFile) {
    console.log(`📋 Plan file: ${planFile}`);
  }
  if (merge) {
    console.log(`🔀 Auto-merge to: ${git.currentBranch}`);
  }
  if (draft) {
    console.log(`📝 Draft PR to: ${effectiveBaseBranch}`);
  }

  // 既存ワークツリーの重複チェック
  const existingWorktree = await findWorktreeByBranch(branchName);

  if (existingWorktree) {
    console.log(`\n⚠️  Worktree already exists: ${existingWorktree.path}`);

    let confirmed: boolean;
    if (existingWorktree.isDirty) {
      console.log("⚠️  警告: 未コミットの変更があります");
      confirmed = await confirm(
        "変更を破棄してworktreeを削除しますか？"
      );
    } else {
      confirmed = await confirm(
        "既存のworktreeを削除して新しいセッションを開始しますか？"
      );
    }

    if (!confirmed) {
      console.log("キャンセルしました。");
      return;
    }

    // preClean hook
    if (config?.preClean) {
      const hookCmd = buildHookCommand(config.preClean, { path: existingWorktree.path });
      const spinner = args.verbose ? null : startSpinner("preClean hook を実行中...");
      try {
        await runHook(hookCmd, git.repoRoot, { verbose: args.verbose });
        spinner?.stop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spinner?.fail(`preClean hook failed (continuing): ${message}`);
        console.warn(`  ⚠️  preClean hook failed (continuing): ${message}`);
      }
    }

    // 既存ワークツリーとブランチを削除
    console.log("🗑️  既存のworktreeを削除中...");
    await removeWorktree(existingWorktree.path, existingWorktree.isDirty);
    console.log(`  ✓ Worktree deleted: ${existingWorktree.path}`);

    try {
      await deleteLocalBranch(branchName, true);
      console.log(`  ✓ Branch deleted: ${branchName}`);
    } catch {
      // ブランチが存在しない場合は無視
      console.log(`  ⚠️  Branch not found (skipping): ${branchName}`);
    }

    console.log("");
  }

  // ブランチのみ存在（ワークツリーなし）のチェック
  if (!existingWorktree) {
    const branchAlreadyExists = await branchExists(branchName);

    if (branchAlreadyExists) {
      console.log(`\n⚠️  ブランチが既に存在します: ${branchName}`);

      const confirmed = await confirm(
        "ブランチを削除して新規作成しますか？"
      );

      if (!confirmed) {
        console.log("キャンセルしました。");
        return;
      }

      console.log("🗑️  既存のブランチを削除中...");
      try {
        await deleteLocalBranch(branchName, true);
        console.log(`  ✓ Branch deleted: ${branchName}`);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.log(`  ❌ ブランチの削除に失敗しました: ${errorMessage}`);
        return;
      }
      console.log("");
    }
  }

  // Create worktree directly
  await createWorktree(branchName, worktreePath, effectiveBaseBranch);

  // postCreate hook
  if (config?.postCreate) {
    let slot: number | undefined;
    if (config.postCreate.includes("{slot}")) {
      slot = await findAvailableSlot();
    }
    const hookCmd = buildHookCommand(config.postCreate, { path: worktreePath, slot });
    const spinner = args.verbose ? null : startSpinner("postCreate hook を実行中...");
    try {
      await runHook(hookCmd, git.repoRoot, { verbose: args.verbose });
      spinner?.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner?.fail("postCreate hook failed");
      console.error(`❌ postCreate hook failed: ${message}`);
      console.log("🗑️  Rolling back...");
      // preClean フックでコンテナ等をクリーンアップしてからワークツリーを削除
      if (config?.preClean) {
        const cleanCmd = buildHookCommand(config.preClean, { path: worktreePath });
        try {
          await runHook(cleanCmd, git.repoRoot, { verbose: args.verbose });
        } catch {
          console.warn("  ⚠️  preClean hook failed during rollback");
        }
      }
      try {
        await removeWorktree(worktreePath);
      } catch {
        console.warn("  ⚠️  Failed to rollback worktree");
      }
      return;
    }
  }

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
    ...(draft && {
      draftInstructions: {
        baseBranch: effectiveBaseBranch,
        branchName,
      },
    }),
  };

  if (pane) {
    // WezTermペインを作成してコマンドを送信
    const paneId = await createPane({ title: taskName, keepFocus: true });
    console.log(`🪟 Created pane: ${paneId}`);

    const commands = [
      `cd "${worktreePath}"`,
      buildClaudeCommand(claudeOptions),
    ].join(" && ");

    await sendCommand(paneId, commands);

    // Claude起動後、プロンプト確定のためにEnterを送信
    await Bun.sleep(2000);
    await sendText(paneId, "\n");

    console.log("✅ Worktree created and Claude started in new pane");
  } else {
    // 現在のターミナルでClaude Codeを起動
    console.log("✅ Worktree created. Starting Claude Code...");

    const commands = [
      `cd "${worktreePath}"`,
      buildClaudeCommand(claudeOptions),
    ].join(" && ");

    const proc = Bun.spawn(["sh", "-c", commands], {
      stdio: ["inherit", "inherit", "inherit"],
    });

    await proc.exited;
  }
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
