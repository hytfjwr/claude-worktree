import { describe, expect, test, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { parseArgs, parseCreateArgs, parseCleanArgs } from "./cli";
import type { GitContext, WorktreeInfo } from "./git";

describe("parseArgs", () => {
  describe("help", () => {
    test("空args - ヘルプを返す", () => {
      const result = parseArgs([]);
      expect(result).toEqual({ type: "help" });
    });

    test("-h フラグ - ヘルプを返す", () => {
      const result = parseArgs(["-h"]);
      expect(result).toEqual({ type: "help" });
    });

    test("--help フラグ - ヘルプを返す", () => {
      const result = parseArgs(["--help"]);
      expect(result).toEqual({ type: "help" });
    });

    test("途中の -h - ヘルプを返す", () => {
      const result = parseArgs(["feature/test", "-h", "task"]);
      expect(result).toEqual({ type: "help" });
    });

    test("途中の --help - ヘルプを返す", () => {
      const result = parseArgs(["clean", "--help"]);
      expect(result).toEqual({ type: "help" });
    });
  });

  describe("clean", () => {
    test("基本 - cleanコマンド", () => {
      const result = parseArgs(["clean"]);
      expect(result).toEqual({
        type: "clean",
        args: { force: false, all: false, dryRun: false },
      });
    });

    test("clean + create引数 - cleanとして解釈", () => {
      const result = parseArgs(["clean"]);
      expect(result.type).toBe("clean");
    });
  });

  describe("create", () => {
    test("branch + task - 基本的なcreate", () => {
      const result = parseArgs(["feature/auth", "Auth実装"]);
      expect(result).toEqual({
        type: "create",
        args: {
          branchName: "feature/auth",
          taskName: "Auth実装",
          prompt: "Auth実装",
          planFile: undefined,
          danger: false,
          merge: false,
          draft: false,
          baseBranch: undefined,
        },
      });
    });

    test("branch + task + inline prompt", () => {
      const result = parseArgs(["feature/auth", "Auth実装", "認証機能を実装して"]);
      expect(result).toEqual({
        type: "create",
        args: {
          branchName: "feature/auth",
          taskName: "Auth実装",
          prompt: "認証機能を実装して",
          planFile: undefined,
          danger: false,
          merge: false,
          draft: false,
          baseBranch: undefined,
        },
      });
    });
  });
});

describe("parseCreateArgs", () => {
  test("基本 - branch + task", () => {
    const result = parseCreateArgs(["feature/test", "テストタスク"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "テストタスク",
      prompt: "テストタスク",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("inline prompt あり", () => {
    const result = parseCreateArgs(["fix/bug", "バグ修正", "このバグを直して"]);
    expect(result).toEqual({
      branchName: "fix/bug",
      taskName: "バグ修正",
      prompt: "このバグを直して",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("--plan オプション", () => {
    const result = parseCreateArgs(["feature/api", "API実装", "--plan", "./plan.md"]);
    expect(result).toEqual({
      branchName: "feature/api",
      taskName: "API実装",
      prompt: "API実装",
      planFile: "./plan.md",
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("--danger オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("--danger + --plan オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "--plan", "plan.md", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "タスク",
      planFile: "plan.md",
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("--merge オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: true,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("--merge + --danger オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--merge", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: true,
      merge: true,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("--merge + --plan オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "--plan", "plan.md", "--merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "タスク",
      planFile: "plan.md",
      danger: false,
      merge: true,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("全オプション組み合わせ --merge + --danger + --plan", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "--plan", "plan.md", "--merge", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "タスク",
      planFile: "plan.md",
      danger: true,
      merge: true,
      draft: false,
      baseBranch: undefined,
    });
  });

  test("--base オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: "develop",
    });
  });

  test("--base + --danger オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--base", "develop", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: false,
      baseBranch: "develop",
    });
  });

  test("--base + --merge オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--base", "develop", "--merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: true,
      draft: false,
      baseBranch: "develop",
    });
  });

  test("--base + --plan オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "--base", "develop", "--plan", "plan.md"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "タスク",
      planFile: "plan.md",
      danger: false,
      merge: false,
      draft: false,
      baseBranch: "develop",
    });
  });

  test("全オプション組み合わせ --base + --merge + --danger + --plan", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "--base", "develop", "--plan", "plan.md", "--merge", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "タスク",
      planFile: "plan.md",
      danger: true,
      merge: true,
      draft: false,
      baseBranch: "develop",
    });
  });

  test("--draft オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--draft"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: true,
      baseBranch: undefined,
    });
  });

  test("--draft + --danger オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--draft", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: true,
      baseBranch: undefined,
    });
  });

  test("--draft + --base オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--draft", "--base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: true,
      baseBranch: "develop",
    });
  });

  test("--draft + --plan オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "--draft", "--plan", "plan.md"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "タスク",
      planFile: "plan.md",
      danger: false,
      merge: false,
      draft: true,
      baseBranch: undefined,
    });
  });

  test("エラー: --merge と --draft の排他性", () => {
    expect(() => parseCreateArgs(["feature/test", "タスク", "プロンプト", "--merge", "--draft"])).toThrow(
      "Cannot use both --merge and --draft options"
    );
  });

  test("エラー: --base に引数がない", () => {
    expect(() => parseCreateArgs(["feature/test", "タスク", "--base"])).toThrow(
      "--base requires a branch name argument"
    );
  });

  test("エラー: 引数が足りない（0個）", () => {
    expect(() => parseCreateArgs([])).toThrow("Usage:");
  });

  test("エラー: 引数が足りない（1個）", () => {
    expect(() => parseCreateArgs(["feature/test"])).toThrow("Usage:");
  });

  test("エラー: --plan に引数がない", () => {
    expect(() => parseCreateArgs(["feature/test", "タスク", "--plan"])).toThrow(
      "--plan requires a file path argument"
    );
  });

  test("エラー: --plan とインラインプロンプトの両方", () => {
    expect(() =>
      parseCreateArgs(["feature/test", "タスク", "プロンプト", "--plan", "plan.md"])
    ).toThrow("Cannot use both --plan and inline prompt");
  });

  test("複数単語のインラインプロンプト", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "これは", "複数", "単語"]);
    expect(result.prompt).toBe("これは 複数 単語");
  });

  test("不明オプションはプロンプトとして扱われる", () => {
    // --unknown は parseCreateArgs では単なる文字列として扱われ、プロンプトの一部になる
    // これは意図した動作として文書化
    const result = parseCreateArgs(["feature/test", "タスク", "--unknown", "text"]);
    expect(result.prompt).toBe("--unknown text");
  });
});

describe("parseCleanArgs", () => {
  test("基本 - オプションなし", () => {
    const result = parseCleanArgs([]);
    expect(result).toEqual({ force: false, all: false, dryRun: false });
  });

  test("--force フラグ", () => {
    const result = parseCleanArgs(["--force"]);
    expect(result.force).toBe(true);
  });

  test("-f フラグ", () => {
    const result = parseCleanArgs(["-f"]);
    expect(result.force).toBe(true);
  });

  test("--all フラグ", () => {
    const result = parseCleanArgs(["--all"]);
    expect(result.all).toBe(true);
  });

  test("-a フラグ", () => {
    const result = parseCleanArgs(["-a"]);
    expect(result.all).toBe(true);
  });

  test("--dry-run フラグ", () => {
    const result = parseCleanArgs(["--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  test("-n フラグ", () => {
    const result = parseCleanArgs(["-n"]);
    expect(result.dryRun).toBe(true);
  });

  test("複合フラグ - --force --all --dry-run", () => {
    const result = parseCleanArgs(["--force", "--all", "--dry-run"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true });
  });

  test("複合フラグ - 短縮形 -f -a -n", () => {
    const result = parseCleanArgs(["-f", "-a", "-n"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true });
  });

  test("-h/--help は無視される（例外を投げない）", () => {
    const result = parseCleanArgs(["-h"]);
    expect(result).toEqual({ force: false, all: false, dryRun: false });
  });

  test("エラー: 不明オプション", () => {
    expect(() => parseCleanArgs(["--unknown"])).toThrow("Unknown option for clean command: --unknown");
  });
});

// ============================================================================
// runCreate のテスト（mock.moduleを使用）
// ============================================================================

describe("runCreate", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let bunSleepSpy: ReturnType<typeof spyOn>;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });
    bunSleepSpy = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    bunSleepSpy.mockRestore();
  });

  test("既存ワークツリーなし - 正常にペイン作成", async () => {
    let paneCreated = false;
    let commandSent = "";

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async () => null),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock((branch: string, path: string, base: string) => `git worktree add -b ${branch} "${path}" ${base}`),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => {
        paneCreated = true;
        return "pane-123";
      }),
      sendCommand: mock(async (_paneId: string, cmd: string) => {
        commandSent = cmd;
      }),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(() => "claude"),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async () => true),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/test", taskName: "Test Task", prompt: "test prompt" });

    expect(paneCreated).toBe(true);
    expect(commandSent).toContain("git worktree add");
    expect(commandSent).toContain("feature/test");
  });

  test("既存ワークツリーあり（クリーン） - 確認後に削除して新規作成", async () => {
    const existingWorktree: WorktreeInfo = {
      path: "/path/to/existing",
      branch: "feature/test",
      isLocked: false,
      isDirty: false,
      isMain: false,
    };

    let worktreeRemoved = false;
    let branchDeleted = false;
    let confirmCalled = false;
    let confirmMessage = "";
    let paneCreated = false;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async (branch: string) =>
        branch === "feature/test" ? existingWorktree : null
      ),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock((branch: string, path: string, base: string) => `git worktree add -b ${branch} "${path}" ${base}`),
      removeWorktree: mock(async () => {
        worktreeRemoved = true;
      }),
      deleteLocalBranch: mock(async () => {
        branchDeleted = true;
      }),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => {
        paneCreated = true;
        return "pane-123";
      }),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(() => "claude"),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async (msg: string) => {
        confirmCalled = true;
        confirmMessage = msg;
        return true;
      }),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/test", taskName: "Test Task", prompt: "test prompt" });

    expect(confirmCalled).toBe(true);
    expect(confirmMessage).toContain("既存のworktreeを削除");
    expect(worktreeRemoved).toBe(true);
    expect(branchDeleted).toBe(true);
    expect(paneCreated).toBe(true);
  });

  test("既存ワークツリーあり（クリーン） - キャンセルで終了", async () => {
    const existingWorktree: WorktreeInfo = {
      path: "/path/to/existing",
      branch: "feature/test",
      isLocked: false,
      isDirty: false,
      isMain: false,
    };

    let paneCreated = false;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async (branch: string) =>
        branch === "feature/test" ? existingWorktree : null
      ),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock(() => ""),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => {
        paneCreated = true;
        return "pane-123";
      }),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(() => "claude"),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async () => false),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/test", taskName: "Test Task", prompt: "test prompt" });

    expect(paneCreated).toBe(false);
    expect(logs).toContain("キャンセルしました。");
  });

  test("既存ワークツリーあり（ダーティ） - 追加警告を表示して確認", async () => {
    const existingWorktree: WorktreeInfo = {
      path: "/path/to/existing",
      branch: "feature/dirty",
      isLocked: false,
      isDirty: true,
      isMain: false,
    };

    let confirmMessage = "";
    let forceRemove = false;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async (branch: string) =>
        branch === "feature/dirty" ? existingWorktree : null
      ),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock(() => ""),
      removeWorktree: mock(async (_path: string, force: boolean) => {
        forceRemove = force || false;
      }),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => "pane-123"),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(() => "claude"),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async (msg: string) => {
        confirmMessage = msg;
        return true;
      }),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/dirty", taskName: "Dirty Task", prompt: "test prompt" });

    expect(logs.some((l) => l.includes("未コミットの変更があります"))).toBe(true);
    expect(confirmMessage).toContain("変更を破棄");
    expect(forceRemove).toBe(true);
  });

  test("ブランチのみ存在（ワークツリーなし） - 確認後に削除して新規作成", async () => {
    let branchDeleted = false;
    let confirmCalled = false;
    let confirmMessage = "";
    let paneCreated = false;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async () => null),
      branchExists: mock(async (branch: string) => branch === "feature/orphan"),
      buildWorktreeCommand: mock(() => ""),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => {
        branchDeleted = true;
      }),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => {
        paneCreated = true;
        return "pane-123";
      }),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(() => "claude"),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async (msg: string) => {
        confirmCalled = true;
        confirmMessage = msg;
        return true;
      }),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/orphan", taskName: "Orphan Task", prompt: "test prompt" });

    expect(confirmCalled).toBe(true);
    expect(confirmMessage).toContain("ブランチを削除して新規作成");
    expect(branchDeleted).toBe(true);
    expect(paneCreated).toBe(true);
    expect(logs.some((l) => l.includes("ブランチが既に存在します"))).toBe(true);
  });

  test("dangerフラグがbuildClaudeCommandに渡される", async () => {
    let dangerFlagPassed = false;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async () => null),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock(() => ""),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => "pane-123"),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(({ dangerouslySkipPermissions }: { dangerouslySkipPermissions?: boolean }) => {
        dangerFlagPassed = dangerouslySkipPermissions === true;
        return "claude --dangerously-skip-permissions";
      }),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async () => true),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/danger", taskName: "Danger Task", prompt: "test", danger: true });

    expect(dangerFlagPassed).toBe(true);
  });

  test("--merge オプションでmergeInstructionsがbuildClaudeCommandに渡される", async () => {
    let mergeInstructionsPassed: { baseBranch: string; worktreePath: string } | undefined;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async () => null),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock(() => ""),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => "pane-123"),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(({ mergeInstructions }: { mergeInstructions?: { baseBranch: string; worktreePath: string } }) => {
        mergeInstructionsPassed = mergeInstructions;
        return "claude";
      }),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async () => true),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/merge", taskName: "Merge Task", prompt: "test", merge: true });

    expect(mergeInstructionsPassed).toBeDefined();
    expect(mergeInstructionsPassed?.baseBranch).toBe("main");
    expect(mergeInstructionsPassed?.worktreePath).toContain("feature-merge");
    expect(logs.some((l) => l.includes("🔀 Auto-merge to: main"))).toBe(true);
  });

  test("--base オプションでbuildWorktreeCommandに指定したベースブランチが渡される", async () => {
    let baseBranchPassed = "";

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async () => null),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock((branch: string, path: string, base: string) => {
        baseBranchPassed = base;
        return `git worktree add -b ${branch} "${path}" ${base}`;
      }),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => "pane-123"),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(() => "claude"),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async () => true),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/base", taskName: "Base Task", prompt: "test", baseBranch: "develop" });

    expect(baseBranchPassed).toBe("develop");
    expect(logs.some((l) => l.includes("🌳 Base branch: develop"))).toBe(true);
  });

  test("--draft オプションでdraftInstructionsがbuildClaudeCommandに渡される", async () => {
    let draftInstructionsPassed: { baseBranch: string; branchName: string } | undefined;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async () => null),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock(() => ""),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => "pane-123"),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(({ draftInstructions }: { draftInstructions?: { baseBranch: string; branchName: string } }) => {
        draftInstructionsPassed = draftInstructions;
        return "claude";
      }),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async () => true),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/draft", taskName: "Draft Task", prompt: "test", draft: true });

    expect(draftInstructionsPassed).toBeDefined();
    expect(draftInstructionsPassed?.baseBranch).toBe("main");
    expect(draftInstructionsPassed?.branchName).toBe("feature/draft");
    expect(logs.some((l) => l.includes("📝 Draft PR to: main"))).toBe(true);
  });

  test("--draft + --base オプションでdraftInstructionsに指定したベースブランチが渡される", async () => {
    let draftInstructionsPassed: { baseBranch: string; branchName: string } | undefined;

    const mockGitContext: GitContext = {
      repoRoot: "/path/to/repo",
      repoName: "repo",
      currentBranch: "main",
    };

    mock.module("./git", () => ({
      getGitContext: mock(async () => mockGitContext),
      getWorktreePath: mock((root: string, name: string, branch: string) => `${root}/../${name}-${branch.replace(/\//g, "-")}`),
      findWorktreeByBranch: mock(async () => null),
      branchExists: mock(async () => false),
      buildWorktreeCommand: mock(() => ""),
      removeWorktree: mock(async () => undefined),
      deleteLocalBranch: mock(async () => undefined),
    }));

    mock.module("./wezterm", () => ({
      createPane: mock(async () => "pane-123"),
      sendCommand: mock(async () => undefined),
      sendText: mock(async () => undefined),
    }));

    mock.module("./claude", () => ({
      buildClaudeCommand: mock(({ draftInstructions }: { draftInstructions?: { baseBranch: string; branchName: string } }) => {
        draftInstructionsPassed = draftInstructions;
        return "claude";
      }),
    }));

    mock.module("./prompt", () => ({
      confirm: mock(async () => true),
    }));

    const { runCreate } = await import("./cli");

    await runCreate({ branchName: "feature/draft", taskName: "Draft Task", prompt: "test", draft: true, baseBranch: "develop" });

    expect(draftInstructionsPassed).toBeDefined();
    expect(draftInstructionsPassed?.baseBranch).toBe("develop");
    expect(draftInstructionsPassed?.branchName).toBe("feature/draft");
    expect(logs.some((l) => l.includes("📝 Draft PR to: develop"))).toBe(true);
  });
});
