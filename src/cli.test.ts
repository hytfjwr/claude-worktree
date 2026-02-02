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
