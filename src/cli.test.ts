import { describe, expect, test } from "bun:test";
import { parseArgs, parseCreateArgs, parseCleanArgs, runCreate, type CreateDependencies } from "./cli";
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
    });
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
// runCreate のテスト（DIを使用したモックテスト）
// ============================================================================

function createMockDeps(overrides: Partial<CreateDependencies> = {}): CreateDependencies {
  const mockGitContext: GitContext = {
    repoRoot: "/path/to/repo",
    repoName: "repo",
    currentBranch: "main",
  };

  const logs: string[] = [];

  return {
    getGitContext: async () => mockGitContext,
    getWorktreePath: (root, name, branch) => `${root}/../${name}-${branch.replace(/\//g, "-")}`,
    findWorktreeByBranch: async () => null,
    removeWorktree: async () => {},
    deleteLocalBranch: async () => {},
    branchExists: async () => false,
    createPane: async () => "mock-pane-id",
    sendCommand: async () => {},
    sendText: async () => {},
    buildWorktreeCommand: (branch, path, base) => `git worktree add -b ${branch} "${path}" ${base}`,
    buildClaudeCommand: () => "claude",
    confirm: async () => true,
    log: (msg: string) => logs.push(msg),
    readPlanFile: async () => "plan content",
    ...overrides,
  };
}

describe("runCreate", () => {
  test("既存ワークツリーなし - 正常にペイン作成", async () => {
    let paneCreated = false;
    let commandSent = "";

    const deps = createMockDeps({
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
      sendCommand: async (_paneId, cmd) => {
        commandSent = cmd;
      },
    });

    await runCreate(
      { branchName: "feature/test", taskName: "Test Task", prompt: "test prompt" },
      deps
    );

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

    const deps = createMockDeps({
      findWorktreeByBranch: async (branch) =>
        branch === "feature/test" ? existingWorktree : null,
      removeWorktree: async () => {
        worktreeRemoved = true;
      },
      deleteLocalBranch: async () => {
        branchDeleted = true;
      },
      confirm: async (msg) => {
        confirmCalled = true;
        confirmMessage = msg;
        return true;
      },
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
    });

    await runCreate(
      { branchName: "feature/test", taskName: "Test Task", prompt: "test prompt" },
      deps
    );

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
    const logs: string[] = [];

    const deps = createMockDeps({
      findWorktreeByBranch: async (branch) =>
        branch === "feature/test" ? existingWorktree : null,
      confirm: async () => false,
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
      log: (msg: string) => logs.push(msg),
    });

    await runCreate(
      { branchName: "feature/test", taskName: "Test Task", prompt: "test prompt" },
      deps
    );

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
    const logs: string[] = [];

    const deps = createMockDeps({
      findWorktreeByBranch: async (branch) =>
        branch === "feature/dirty" ? existingWorktree : null,
      removeWorktree: async (_path, force) => {
        forceRemove = force || false;
      },
      confirm: async (msg) => {
        confirmMessage = msg;
        return true;
      },
      log: (msg: string) => logs.push(msg),
    });

    await runCreate(
      { branchName: "feature/dirty", taskName: "Dirty Task", prompt: "test prompt" },
      deps
    );

    expect(logs.some((l) => l.includes("未コミットの変更があります"))).toBe(true);
    expect(confirmMessage).toContain("変更を破棄");
    expect(forceRemove).toBe(true);
  });

  test("既存ワークツリーあり（ダーティ） - キャンセルで終了", async () => {
    const existingWorktree: WorktreeInfo = {
      path: "/path/to/existing",
      branch: "feature/dirty",
      isLocked: false,
      isDirty: true,
      isMain: false,
    };

    let paneCreated = false;
    let worktreeRemoved = false;
    const logs: string[] = [];

    const deps = createMockDeps({
      findWorktreeByBranch: async (branch) =>
        branch === "feature/dirty" ? existingWorktree : null,
      removeWorktree: async () => {
        worktreeRemoved = true;
      },
      confirm: async () => false,
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
      log: (msg: string) => logs.push(msg),
    });

    await runCreate(
      { branchName: "feature/dirty", taskName: "Dirty Task", prompt: "test prompt" },
      deps
    );

    expect(paneCreated).toBe(false);
    expect(worktreeRemoved).toBe(false);
    expect(logs).toContain("キャンセルしました。");
  });

  test("プランファイルからプロンプトを読み込み", async () => {
    let commandSent = "";

    const deps = createMockDeps({
      readPlanFile: async () => "プランファイルの内容",
      buildClaudeCommand: ({ prompt }) => `claude --prompt "${prompt}"`,
      sendCommand: async (_paneId, cmd) => {
        commandSent = cmd;
      },
    });

    await runCreate(
      { branchName: "feature/plan", taskName: "Plan Task", prompt: "ignored", planFile: "./plan.md" },
      deps
    );

    expect(commandSent).toContain("プランファイルの内容");
  });

  test("ブランチのみ存在（ワークツリーなし） - 確認後に削除して新規作成", async () => {
    let branchDeleted = false;
    let confirmCalled = false;
    let confirmMessage = "";
    let paneCreated = false;
    const logs: string[] = [];

    const deps = createMockDeps({
      findWorktreeByBranch: async () => null,
      branchExists: async (branch) => branch === "feature/orphan",
      deleteLocalBranch: async () => {
        branchDeleted = true;
      },
      confirm: async (msg) => {
        confirmCalled = true;
        confirmMessage = msg;
        return true;
      },
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
      log: (msg: string) => logs.push(msg),
    });

    await runCreate(
      { branchName: "feature/orphan", taskName: "Orphan Task", prompt: "test prompt" },
      deps
    );

    expect(confirmCalled).toBe(true);
    expect(confirmMessage).toContain("ブランチを削除して新規作成");
    expect(branchDeleted).toBe(true);
    expect(paneCreated).toBe(true);
    expect(logs.some((l) => l.includes("ブランチが既に存在します"))).toBe(true);
  });

  test("ブランチのみ存在（ワークツリーなし） - キャンセルで終了", async () => {
    let paneCreated = false;
    let branchDeleted = false;
    const logs: string[] = [];

    const deps = createMockDeps({
      findWorktreeByBranch: async () => null,
      branchExists: async (branch) => branch === "feature/orphan",
      deleteLocalBranch: async () => {
        branchDeleted = true;
      },
      confirm: async () => false,
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
      log: (msg: string) => logs.push(msg),
    });

    await runCreate(
      { branchName: "feature/orphan", taskName: "Orphan Task", prompt: "test prompt" },
      deps
    );

    expect(paneCreated).toBe(false);
    expect(branchDeleted).toBe(false);
    expect(logs).toContain("キャンセルしました。");
  });

  test("ブランチもワークツリーもなし - 正常に新規作成", async () => {
    let paneCreated = false;
    let commandSent = "";

    const deps = createMockDeps({
      findWorktreeByBranch: async () => null,
      branchExists: async () => false,
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
      sendCommand: async (_paneId, cmd) => {
        commandSent = cmd;
      },
    });

    await runCreate(
      { branchName: "feature/new", taskName: "New Task", prompt: "test prompt" },
      deps
    );

    expect(paneCreated).toBe(true);
    expect(commandSent).toContain("git worktree add");
    expect(commandSent).toContain("feature/new");
  });

  test("ブランチ削除失敗 - エラー表示して終了", async () => {
    let paneCreated = false;
    const logs: string[] = [];

    const deps = createMockDeps({
      findWorktreeByBranch: async () => null,
      branchExists: async (branch) => branch === "feature/orphan",
      deleteLocalBranch: async () => {
        throw new Error("Branch deletion failed: some error");
      },
      confirm: async () => true,
      createPane: async () => {
        paneCreated = true;
        return "pane-123";
      },
      log: (msg: string) => logs.push(msg),
    });

    await runCreate(
      { branchName: "feature/orphan", taskName: "Orphan Task", prompt: "test prompt" },
      deps
    );

    expect(paneCreated).toBe(false);
    expect(logs.some((l) => l.includes("ブランチの削除に失敗しました"))).toBe(true);
  });
});
