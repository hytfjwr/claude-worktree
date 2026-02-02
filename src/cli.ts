import { getGitContext, getWorktreePath, buildWorktreeCommand } from "./git";
import { createPane, sendCommand, sendText } from "./wezterm";
import { buildClaudeCommand } from "./claude";

export interface CliArgs {
  branchName: string;
  taskName: string;
  prompt: string;
}

export function parseArgs(args: string[]): CliArgs {
  if (args.length < 2) {
    throw new Error(
      "Usage: claude-worktree <branch-name> <task-name> [prompt]\n" +
        "Example: claude-worktree feature/auth 'Auth実装' '認証機能を実装して'"
    );
  }

  return {
    branchName: args[0],
    taskName: args[1],
    prompt: args.slice(2).join(" ") || args[1],
  };
}

export async function run(args: CliArgs): Promise<void> {
  const { branchName, taskName, prompt } = args;

  // Git情報を取得
  const git = await getGitContext();
  const worktreePath = getWorktreePath(git.repoRoot, git.repoName, branchName);

  console.log(`📍 Current branch: ${git.currentBranch}`);
  console.log(`🌿 New branch: ${branchName}`);
  console.log(`📂 Worktree path: ${worktreePath}`);
  console.log(`📝 Task: ${taskName}`);

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
