import { describe, expect, test } from "bun:test";
import { buildClaudeCommand } from "./claude";

describe("buildClaudeCommand", () => {
  test("basic prompt - default permission mode and suffix are applied", () => {
    const result = buildClaudeCommand({ prompt: "Test prompt" });

    expect(result).toContain("--permission-mode plan");
    expect(result).toContain("Test prompt");
    expect(result).toContain("If anything is unclear, always confirm with the user before proceeding.");
    expect(result).toStartWith("claude ");
  });

  test("custom permission mode - auto-edit", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      permissionMode: "auto-edit",
    });

    expect(result).toContain("--permission-mode auto-edit");
  });

  test("custom permission mode - full-auto", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      permissionMode: "full-auto",
    });

    expect(result).toContain("--permission-mode full-auto");
  });

  test("double quote escaping - no escaping needed in heredoc format", () => {
    const result = buildClaudeCommand({ prompt: '"hello" world', promptSuffix: "" });

    // Double quotes can be used as-is in heredoc format
    expect(result).toContain('"hello" world');
    expect(result).toContain("<<'PROMPT_END'");
    expect(result).toContain("PROMPT_END");
  });

  test("custom promptSuffix", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      promptSuffix: "\n\nCustom suffix",
    });

    expect(result).toContain("Test");
    expect(result).toContain("Custom suffix");
    expect(result).not.toContain("If anything is unclear");
  });

  test("empty promptSuffix - no suffix", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      promptSuffix: "",
    });

    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
Test
PROMPT_END`);
  });

  test("combined case - custom permission mode + custom suffix + escaping", () => {
    const result = buildClaudeCommand({
      prompt: 'Implement function "test"',
      permissionMode: "auto-edit",
      promptSuffix: "\n\nRun tests after completion",
    });

    expect(result).toContain("--permission-mode auto-edit");
    // Double quotes don't need escaping in heredoc format
    expect(result).toContain('"test"');
    expect(result).toContain("Run tests after completion");
  });

  test("dangerouslySkipPermissions - flag is added", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      dangerouslySkipPermissions: true,
    });

    expect(result).toContain("--dangerously-skip-permissions");
    expect(result).toStartWith("claude --dangerously-skip-permissions");
  });

  test("dangerouslySkipPermissions false - flag is not added", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      dangerouslySkipPermissions: false,
    });

    expect(result).not.toContain("--dangerously-skip-permissions");
  });

  test("dangerouslySkipPermissions unspecified - flag is not added by default", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
    });

    expect(result).not.toContain("--dangerously-skip-permissions");
  });

  test("with mergeInstructions - merge instructions are included", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      mergeInstructions: {
        baseBranch: "main",
        worktreePath: "/path/to/worktree",
      },
    });

    expect(result).toContain("[IMPORTANT] Post-Task Steps");
    expect(result).toContain("Merge into the base branch");
  });

  test("mergeInstructions - base branch name is correctly embedded", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      mergeInstructions: {
        baseBranch: "develop",
        worktreePath: "/path/to/worktree",
      },
    });

    expect(result).toContain("Merge target: develop");
  });

  test("mergeInstructions - worktree path is correctly embedded", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      mergeInstructions: {
        baseBranch: "main",
        worktreePath: "/custom/path/to/worktree",
      },
    });

    // Double quotes don't need escaping in heredoc format
    expect(result).toContain('Remove worktree: git worktree remove "/custom/path/to/worktree"');
  });

  test("without mergeInstructions - merge instructions are not included", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
    });

    expect(result).not.toContain("[IMPORTANT] Post-Task Steps");
    expect(result).not.toContain("Merge into the base branch");
  });

  test("mergeInstructions + dangerouslySkipPermissions combined", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      dangerouslySkipPermissions: true,
      mergeInstructions: {
        baseBranch: "main",
        worktreePath: "/path/to/worktree",
      },
    });

    expect(result).toContain("--dangerously-skip-permissions");
    expect(result).toContain("[IMPORTANT] Post-Task Steps");
  });

  test("with draftInstructions - Draft PR instructions are included", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      draftInstructions: {
        baseBranch: "main",
        branchName: "feature/test",
      },
    });

    expect(result).toContain("[IMPORTANT] Post-Task Steps");
    expect(result).toContain("Create a Draft PR");
    expect(result).toContain("gh pr create --draft --base main");
  });

  test("draftInstructions - base branch name is correctly embedded", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      draftInstructions: {
        baseBranch: "develop",
        branchName: "feature/test",
      },
    });

    expect(result).toContain("gh pr create --draft --base develop");
  });

  test("draftInstructions - branch name is correctly embedded", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      draftInstructions: {
        baseBranch: "main",
        branchName: "feature/my-feature",
      },
    });

    expect(result).toContain("git push -u origin feature/my-feature");
  });

  test("without draftInstructions - Draft PR instructions are not included", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
    });

    expect(result).not.toContain("Create a Draft PR");
    expect(result).not.toContain("gh pr create --draft");
  });

  test("draftInstructions + dangerouslySkipPermissions combined", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      dangerouslySkipPermissions: true,
      draftInstructions: {
        baseBranch: "main",
        branchName: "feature/test",
      },
    });

    expect(result).toContain("--dangerously-skip-permissions");
    expect(result).toContain("Create a Draft PR");
  });
});

// ============================================================================
// Edge case tests
// ============================================================================

describe("buildClaudeCommand - edge cases", () => {
  test("empty prompt - no error", () => {
    const result = buildClaudeCommand({ prompt: "", promptSuffix: "" });

    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'

PROMPT_END`);
  });

  test("prompt with newlines - newlines are preserved", () => {
    const result = buildClaudeCommand({
      prompt: "line1\nline2\nline3",
      promptSuffix: "",
    });

    // Newlines are preserved in heredoc format
    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
line1
line2
line3
PROMPT_END`);
  });

  test("prompt with backslashes - preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "path\\to\\file",
      promptSuffix: "",
    });

    // Backslashes are preserved in heredoc format
    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
path\\to\\file
PROMPT_END`);
  });

  test("prompt with single quotes - preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "It's a test",
      promptSuffix: "",
    });

    // Single quotes are preserved in heredoc format
    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
It's a test
PROMPT_END`);
  });

  test("$ variable expansion characters - $ is preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "$HOME/path",
      promptSuffix: "",
    });

    // $ is not expanded in heredoc format
    expect(result).toContain("$HOME/path");
  });

  test("backticks - backticks are preserved", () => {
    const result = buildClaudeCommand({
      prompt: "`code block`",
      promptSuffix: "",
    });

    expect(result).toContain("`code block`");
  });

  test("extremely long prompt - works normally (smoke test)", () => {
    const longText = "a".repeat(10000);
    const result = buildClaudeCommand({
      prompt: longText,
      promptSuffix: "",
    });

    expect(result).toContain(longText);
    expect(result.length).toBeGreaterThan(10000);
  });

  test("prompt with tab characters - preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "col1\tcol2\tcol3",
      promptSuffix: "",
    });

    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
col1\tcol2\tcol3
PROMPT_END`);
  });

  test("prompt with carriage return - preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "line1\r\nline2",
      promptSuffix: "",
    });

    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
line1\r
line2
PROMPT_END`);
  });

  test("combined special characters - all preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "It's a \"test\"\npath\\to\\file",
      promptSuffix: "",
    });

    // All special characters are preserved in heredoc format
    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
It's a "test"
path\\to\\file
PROMPT_END`);
  });
});
