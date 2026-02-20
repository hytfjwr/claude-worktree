import { describe, expect, test } from "vitest";

import { buildClaudeCommand, buildResumeCommand, shellEscape } from "./claude.ts";

describe("buildClaudeCommand", () => {
  test("basic prompt - default permission mode and suffix are applied", () => {
    const result = buildClaudeCommand({ prompt: "Test prompt" });

    expect(result).toContain("--permission-mode plan");
    expect(result).toContain("Test prompt");
    expect(result).toContain("If anything is unclear, always confirm with the user before proceeding.");
    expect(result).toMatch(/^claude /);
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

  test("double quotes in prompt - preserved inside single quotes", () => {
    const result = buildClaudeCommand({ prompt: '"hello" world', promptSuffix: "" });

    expect(result).toContain('"hello" world');
    expect(result).toContain("-- '");
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

    expect(result).toBe("claude --permission-mode plan -- 'Test'");
  });

  test("combined case - custom permission mode + custom suffix + escaping", () => {
    const result = buildClaudeCommand({
      prompt: 'Implement function "test"',
      permissionMode: "auto-edit",
      promptSuffix: "\n\nRun tests after completion",
    });

    expect(result).toContain("--permission-mode auto-edit");
    expect(result).toContain('"test"');
    expect(result).toContain("Run tests after completion");
  });

  test("dangerouslySkipPermissions - flag is added", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      dangerouslySkipPermissions: true,
    });

    expect(result).toContain("--dangerously-skip-permissions");
    expect(result).toMatch(/^claude --dangerously-skip-permissions/);
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

  test("with prInstructions - PR instructions are included", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      prInstructions: {
        baseBranch: "main",
        branchName: "feature/test",
      },
    });

    expect(result).toContain("[IMPORTANT] Post-Task Steps");
    expect(result).toContain("Create a PR");
    expect(result).toContain("gh pr create --base main");
    expect(result).not.toContain("--draft");
  });

  test("prInstructions - base branch name is correctly embedded", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      prInstructions: {
        baseBranch: "develop",
        branchName: "feature/test",
      },
    });

    expect(result).toContain("gh pr create --base develop");
  });

  test("prInstructions - branch name is correctly embedded", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      prInstructions: {
        baseBranch: "main",
        branchName: "feature/my-feature",
      },
    });

    expect(result).toContain("git push -u origin feature/my-feature");
  });

  test("without prInstructions - PR instructions are not included", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
    });

    expect(result).not.toContain("Create a PR");
    expect(result).not.toContain("gh pr create --base");
  });

  test("prInstructions + dangerouslySkipPermissions combined", () => {
    const result = buildClaudeCommand({
      prompt: "Test",
      dangerouslySkipPermissions: true,
      prInstructions: {
        baseBranch: "main",
        branchName: "feature/test",
      },
    });

    expect(result).toContain("--dangerously-skip-permissions");
    expect(result).toContain("Create a PR");
    expect(result).not.toContain("--draft");
  });
});

// ============================================================================
// Edge case tests
// ============================================================================

describe("buildClaudeCommand - edge cases", () => {
  test("empty prompt - no error", () => {
    const result = buildClaudeCommand({ prompt: "", promptSuffix: "" });

    expect(result).toBe("claude --permission-mode plan -- ''");
  });

  test("prompt with newlines - newlines are preserved", () => {
    const result = buildClaudeCommand({
      prompt: "line1\nline2\nline3",
      promptSuffix: "",
    });

    // Newlines are preserved inside single quotes
    expect(result).toBe("claude --permission-mode plan -- 'line1\nline2\nline3'");
  });

  test("prompt with backslashes - preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "path\\to\\file",
      promptSuffix: "",
    });

    // Backslashes are preserved inside single quotes
    expect(result).toBe("claude --permission-mode plan -- 'path\\to\\file'");
  });

  test("prompt with single quotes - escaped correctly", () => {
    const result = buildClaudeCommand({
      prompt: "It's a test",
      promptSuffix: "",
    });

    // Single quotes are escaped as '\''
    expect(result).toBe("claude --permission-mode plan -- 'It'\\''s a test'");
  });

  test("$ variable expansion characters - $ is preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "$HOME/path",
      promptSuffix: "",
    });

    // $ is not expanded inside single quotes
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

    expect(result).toBe("claude --permission-mode plan -- 'col1\tcol2\tcol3'");
  });

  test("prompt with carriage return - preserved as-is", () => {
    const result = buildClaudeCommand({
      prompt: "line1\r\nline2",
      promptSuffix: "",
    });

    expect(result).toBe("claude --permission-mode plan -- 'line1\r\nline2'");
  });

  test("combined special characters - all preserved correctly", () => {
    const result = buildClaudeCommand({
      prompt: 'It\'s a "test"\npath\\to\\file',
      promptSuffix: "",
    });

    // Single quotes are escaped, everything else preserved inside single quotes
    expect(result).toBe("claude --permission-mode plan -- 'It'\\''s a \"test\"\npath\\to\\file'");
  });

  test("prompt containing PROMPT_END - treated as normal text", () => {
    const result = buildClaudeCommand({
      prompt: "before\nPROMPT_END\nafter",
      promptSuffix: "",
    });

    // PROMPT_END is just regular text now, no special handling needed
    expect(result).toContain("PROMPT_END");
    expect(result).toBe("claude --permission-mode plan -- 'before\nPROMPT_END\nafter'");
  });
});

// ============================================================================
// buildResumeCommand tests
// ============================================================================

describe("buildResumeCommand", () => {
  test("no prompt - simple --continue", () => {
    const result = buildResumeCommand({});
    expect(result).toBe("claude --continue");
  });

  test("with prompt - shell-escaped positional argument", () => {
    const result = buildResumeCommand({ prompt: "Continue the work" });
    expect(result).toBe("claude --continue -- 'Continue the work'");
  });

  test("with dangerouslySkipPermissions - flag added", () => {
    const result = buildResumeCommand({ dangerouslySkipPermissions: true });
    expect(result).toBe("claude --continue --dangerously-skip-permissions");
  });

  test("with prompt and dangerouslySkipPermissions", () => {
    const result = buildResumeCommand({
      prompt: "Fix the bug",
      dangerouslySkipPermissions: true,
    });
    expect(result).toBe("claude --continue --dangerously-skip-permissions -- 'Fix the bug'");
  });

  test("dangerouslySkipPermissions false - flag not added", () => {
    const result = buildResumeCommand({ dangerouslySkipPermissions: false });
    expect(result).toBe("claude --continue");
  });

  test("empty prompt - treated as no prompt", () => {
    const result = buildResumeCommand({ prompt: "" });
    expect(result).toBe("claude --continue");
  });

  test("prompt with special characters - preserved inside single quotes", () => {
    const result = buildResumeCommand({ prompt: 'It\'s a "test" with $vars' });
    expect(result).toContain("'It'\\''s a \"test\" with $vars'");
  });

  test("prompt with newlines - preserved", () => {
    const result = buildResumeCommand({ prompt: "line1\nline2" });
    expect(result).toBe("claude --continue -- 'line1\nline2'");
  });

  test("prompt containing PROMPT_END - treated as normal text", () => {
    const result = buildResumeCommand({ prompt: "before\nPROMPT_END\nafter" });
    expect(result).toBe("claude --continue -- 'before\nPROMPT_END\nafter'");
  });
});

// ============================================================================
// shellEscape tests
// ============================================================================

describe("shellEscape", () => {
  test("simple string - wraps in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  test("string with single quote - escapes correctly", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  test("string with multiple single quotes - all escaped", () => {
    expect(shellEscape("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });

  test("string with double quotes - preserved as-is", () => {
    expect(shellEscape('"hello"')).toBe("'\"hello\"'");
  });

  test("string with backslashes - preserved as-is", () => {
    expect(shellEscape("path\\to\\file")).toBe("'path\\to\\file'");
  });

  test("string with $ - preserved as-is (no expansion)", () => {
    expect(shellEscape("$HOME")).toBe("'$HOME'");
  });

  test("string with backticks - preserved as-is", () => {
    expect(shellEscape("`cmd`")).toBe("'`cmd`'");
  });

  test("empty string - returns empty single quotes", () => {
    expect(shellEscape("")).toBe("''");
  });

  test("string with newlines - preserved inside single quotes", () => {
    expect(shellEscape("line1\nline2")).toBe("'line1\nline2'");
  });
});
