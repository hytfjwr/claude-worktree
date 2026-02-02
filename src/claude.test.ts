import { describe, expect, test } from "bun:test";
import { buildClaudeCommand } from "./claude";

describe("buildClaudeCommand", () => {
  test("基本的なプロンプト - デフォルトのpermission modeとsuffixが付く", () => {
    const result = buildClaudeCommand({ prompt: "テストプロンプト" });

    expect(result).toContain("--permission-mode plan");
    expect(result).toContain("テストプロンプト");
    expect(result).toContain("不明瞭な点は必ずユーザーに確認し、明確にしながら進めてください");
    expect(result).toStartWith("claude ");
  });

  test("カスタムpermission mode - auto-edit", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      permissionMode: "auto-edit",
    });

    expect(result).toContain("--permission-mode auto-edit");
  });

  test("カスタムpermission mode - full-auto", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      permissionMode: "full-auto",
    });

    expect(result).toContain("--permission-mode full-auto");
  });

  test("ダブルクォートのエスケープ", () => {
    const result = buildClaudeCommand({ prompt: '"hello" world' });

    expect(result).toContain('\\"hello\\" world');
  });

  test("カスタムpromptSuffix", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      promptSuffix: "\n\nカスタムサフィックス",
    });

    expect(result).toContain("テスト");
    expect(result).toContain("カスタムサフィックス");
    expect(result).not.toContain("不明瞭な点は必ずユーザーに確認し");
  });

  test("空のpromptSuffix - サフィックスなし", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      promptSuffix: "",
    });

    expect(result).toBe('claude --permission-mode plan "テスト"');
  });

  test("複合ケース - カスタムpermission mode + カスタムsuffix + エスケープ", () => {
    const result = buildClaudeCommand({
      prompt: '関数"test"を実装して',
      permissionMode: "auto-edit",
      promptSuffix: "\n\n完了後にテストを実行",
    });

    expect(result).toContain("--permission-mode auto-edit");
    expect(result).toContain('\\"test\\"');
    expect(result).toContain("完了後にテストを実行");
  });

  test("dangerouslySkipPermissions - フラグが付く", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      dangerouslySkipPermissions: true,
    });

    expect(result).toContain("--dangerously-skip-permissions");
    expect(result).toStartWith("claude --dangerously-skip-permissions");
  });

  test("dangerouslySkipPermissions false - フラグが付かない", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      dangerouslySkipPermissions: false,
    });

    expect(result).not.toContain("--dangerously-skip-permissions");
  });

  test("dangerouslySkipPermissions 未指定 - デフォルトでフラグが付かない", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
    });

    expect(result).not.toContain("--dangerously-skip-permissions");
  });
});

// ============================================================================
// エッジケーステスト
// ============================================================================

describe("buildClaudeCommand - エッジケース", () => {
  test("空プロンプト - エラーにならない", () => {
    const result = buildClaudeCommand({ prompt: "", promptSuffix: "" });

    expect(result).toBe('claude --permission-mode plan ""');
  });

  test("改行を含むプロンプト - 改行が保持される", () => {
    const result = buildClaudeCommand({
      prompt: "行1\n行2\n行3",
      promptSuffix: "",
    });

    expect(result).toContain("行1\n行2\n行3");
  });

  test("バックスラッシュを含むプロンプト - バックスラッシュが保持される", () => {
    const result = buildClaudeCommand({
      prompt: "path\\to\\file",
      promptSuffix: "",
    });

    expect(result).toContain("path\\to\\file");
  });

  test("シングルクォートを含むプロンプト - シングルクォートが保持される", () => {
    const result = buildClaudeCommand({
      prompt: "It's a test",
      promptSuffix: "",
    });

    expect(result).toContain("It's a test");
  });

  test("$変数展開の文字 - $がそのまま保持される", () => {
    const result = buildClaudeCommand({
      prompt: "$HOME/path",
      promptSuffix: "",
    });

    expect(result).toContain("$HOME/path");
  });

  test("バッククォート - バッククォートが保持される", () => {
    const result = buildClaudeCommand({
      prompt: "`code block`",
      promptSuffix: "",
    });

    expect(result).toContain("`code block`");
  });

  test("極端に長いプロンプト - 正常動作（スモークテスト）", () => {
    const longText = "a".repeat(10000);
    const result = buildClaudeCommand({
      prompt: longText,
      promptSuffix: "",
    });

    expect(result).toContain(longText);
    expect(result.length).toBeGreaterThan(10000);
  });
});
