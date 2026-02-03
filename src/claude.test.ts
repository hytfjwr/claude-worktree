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

  test("ダブルクォートのエスケープ - $'...'形式ではエスケープ不要", () => {
    const result = buildClaudeCommand({ prompt: '"hello" world', promptSuffix: "" });

    // $'...' 形式ではダブルクォートはそのまま使える
    expect(result).toContain('"hello" world');
    expect(result).toMatch(/\$'.*"hello" world.*'/);
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

    expect(result).toBe("claude --permission-mode plan $'テスト'");
  });

  test("複合ケース - カスタムpermission mode + カスタムsuffix + エスケープ", () => {
    const result = buildClaudeCommand({
      prompt: '関数"test"を実装して',
      permissionMode: "auto-edit",
      promptSuffix: "\n\n完了後にテストを実行",
    });

    expect(result).toContain("--permission-mode auto-edit");
    // $'...' 形式ではダブルクォートはエスケープ不要
    expect(result).toContain('"test"');
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

  test("mergeInstructionsあり - マージ指示が含まれる", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      mergeInstructions: {
        baseBranch: "main",
        worktreePath: "/path/to/worktree",
      },
    });

    expect(result).toContain("【重要】タスク完了後の処理");
    expect(result).toContain("ベースブランチへマージ");
  });

  test("mergeInstructions - ベースブランチ名が正しく埋め込まれる", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      mergeInstructions: {
        baseBranch: "develop",
        worktreePath: "/path/to/worktree",
      },
    });

    expect(result).toContain("マージ対象: develop");
  });

  test("mergeInstructions - worktreeパスが正しく埋め込まれる", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      mergeInstructions: {
        baseBranch: "main",
        worktreePath: "/custom/path/to/worktree",
      },
    });

    // $'...' 形式ではダブルクォートはエスケープ不要
    expect(result).toContain('worktree削除: git worktree remove "/custom/path/to/worktree"');
  });

  test("mergeInstructionsなし - マージ指示が含まれない", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
    });

    expect(result).not.toContain("【重要】タスク完了後の処理");
    expect(result).not.toContain("ベースブランチへマージ");
  });

  test("mergeInstructions + dangerouslySkipPermissions 組み合わせ", () => {
    const result = buildClaudeCommand({
      prompt: "テスト",
      dangerouslySkipPermissions: true,
      mergeInstructions: {
        baseBranch: "main",
        worktreePath: "/path/to/worktree",
      },
    });

    expect(result).toContain("--dangerously-skip-permissions");
    expect(result).toContain("【重要】タスク完了後の処理");
  });
});

// ============================================================================
// エッジケーステスト
// ============================================================================

describe("buildClaudeCommand - エッジケース", () => {
  test("空プロンプト - エラーにならない", () => {
    const result = buildClaudeCommand({ prompt: "", promptSuffix: "" });

    expect(result).toBe("claude --permission-mode plan $''");
  });

  test("改行を含むプロンプト - 改行が \\n にエスケープされる", () => {
    const result = buildClaudeCommand({
      prompt: "行1\n行2\n行3",
      promptSuffix: "",
    });

    // 改行は \n にエスケープされる（シェルの $'...' 形式で解釈される）
    expect(result).toBe("claude --permission-mode plan $'行1\\n行2\\n行3'");
  });

  test("バックスラッシュを含むプロンプト - バックスラッシュが \\\\ にエスケープされる", () => {
    const result = buildClaudeCommand({
      prompt: "path\\to\\file",
      promptSuffix: "",
    });

    // バックスラッシュは \\\\ にエスケープされる
    expect(result).toBe("claude --permission-mode plan $'path\\\\to\\\\file'");
  });

  test("シングルクォートを含むプロンプト - シングルクォートがエスケープされる", () => {
    const result = buildClaudeCommand({
      prompt: "It's a test",
      promptSuffix: "",
    });

    // シングルクォートは \\' にエスケープされる
    expect(result).toBe("claude --permission-mode plan $'It\\'s a test'");
  });

  test("$変数展開の文字 - $がそのまま保持される", () => {
    const result = buildClaudeCommand({
      prompt: "$HOME/path",
      promptSuffix: "",
    });

    // $'...' 形式では $ は変数展開されない
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

  test("タブ文字を含むプロンプト - タブが \\t にエスケープされる", () => {
    const result = buildClaudeCommand({
      prompt: "col1\tcol2\tcol3",
      promptSuffix: "",
    });

    expect(result).toBe("claude --permission-mode plan $'col1\\tcol2\\tcol3'");
  });

  test("キャリッジリターンを含むプロンプト - CRが \\r にエスケープされる", () => {
    const result = buildClaudeCommand({
      prompt: "line1\r\nline2",
      promptSuffix: "",
    });

    expect(result).toBe("claude --permission-mode plan $'line1\\r\\nline2'");
  });

  test("複合的な特殊文字 - 全てが正しくエスケープされる", () => {
    const result = buildClaudeCommand({
      prompt: "It's a \"test\"\npath\\to\\file",
      promptSuffix: "",
    });

    // シングルクォート、改行、バックスラッシュがエスケープされる
    // ダブルクォートはそのまま
    expect(result).toBe("claude --permission-mode plan $'It\\'s a \"test\"\\npath\\\\to\\\\file'");
  });
});
