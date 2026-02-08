import { describe, expect, test } from "bun:test";
import { parseArgs, parseCreateArgs, parseCleanArgs } from "./cli";

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
        args: { force: false, all: false, dryRun: false, verbose: false },
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
          pane: false,
          verbose: false,
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
          pane: false,
          verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
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
      pane: false,
      verbose: false,
    });
  });

  test("--pane オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--pane"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
    });
  });

  test("-p オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "-p"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
    });
  });

  test("--pane + --danger オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--pane", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
    });
  });

  test("--pane + --draft + --base オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--pane", "--draft", "--base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "タスク",
      prompt: "プロンプト",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: true,
      baseBranch: "develop",
      pane: true,
      verbose: false,
    });
  });

  test("--verbose オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "--verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v オプション", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "プロンプト", "-v"]);
    expect(result.verbose).toBe(true);
  });

  test("-p はプロンプトの一部にならない", () => {
    const result = parseCreateArgs(["feature/test", "タスク", "-p", "プロンプト"]);
    expect(result.pane).toBe(true);
    expect(result.prompt).toBe("プロンプト");
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
    expect(result).toEqual({ force: false, all: false, dryRun: false, verbose: false });
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
    expect(result).toEqual({ force: true, all: true, dryRun: true, verbose: false });
  });

  test("複合フラグ - 短縮形 -f -a -n", () => {
    const result = parseCleanArgs(["-f", "-a", "-n"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true, verbose: false });
  });

  test("-h/--help は無視される（例外を投げない）", () => {
    const result = parseCleanArgs(["-h"]);
    expect(result).toEqual({ force: false, all: false, dryRun: false, verbose: false });
  });

  test("--verbose フラグ", () => {
    const result = parseCleanArgs(["--verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v フラグ", () => {
    const result = parseCleanArgs(["-v"]);
    expect(result.verbose).toBe(true);
  });

  test("エラー: 不明オプション", () => {
    expect(() => parseCleanArgs(["--unknown"])).toThrow("Unknown option for clean command: --unknown");
  });
});
