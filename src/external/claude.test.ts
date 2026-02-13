import { describe, expect, test } from "vitest";

import { buildClaudeCommand, buildResumeCommand, findSafeDelimiter } from "./claude.ts";

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
      prompt: 'It\'s a "test"\npath\\to\\file',
      promptSuffix: "",
    });

    // All special characters are preserved in heredoc format
    expect(result).toBe(`claude --permission-mode plan <<'PROMPT_END'
It's a "test"
path\\to\\file
PROMPT_END`);
  });

  test("prompt containing PROMPT_END - uses alternative delimiter", () => {
    const result = buildClaudeCommand({
      prompt: "before\nPROMPT_END\nafter",
      promptSuffix: "",
    });

    expect(result).toContain("<<'PROMPT_END_'");
    expect(result).toContain("before\nPROMPT_END\nafter");
    expect(result).toMatch(/PROMPT_END_$/);
    expect(result).not.toMatch(/<<'PROMPT_END'\n/);
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

  test("with prompt - heredoc format", () => {
    const result = buildResumeCommand({ prompt: "Continue the work" });
    expect(result).toBe(`claude --continue <<'PROMPT_END'
Continue the work
PROMPT_END`);
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
    expect(result).toBe(`claude --continue --dangerously-skip-permissions <<'PROMPT_END'
Fix the bug
PROMPT_END`);
  });

  test("dangerouslySkipPermissions false - flag not added", () => {
    const result = buildResumeCommand({ dangerouslySkipPermissions: false });
    expect(result).toBe("claude --continue");
  });

  test("empty prompt - treated as no prompt", () => {
    const result = buildResumeCommand({ prompt: "" });
    expect(result).toBe("claude --continue");
  });

  test("prompt with special characters - preserved in heredoc", () => {
    const result = buildResumeCommand({ prompt: 'It\'s a "test" with $vars' });
    expect(result).toContain('It\'s a "test" with $vars');
    expect(result).toContain("<<'PROMPT_END'");
  });

  test("prompt with newlines - preserved", () => {
    const result = buildResumeCommand({ prompt: "line1\nline2" });
    expect(result).toBe(`claude --continue <<'PROMPT_END'
line1
line2
PROMPT_END`);
  });

  test("prompt containing PROMPT_END - uses alternative delimiter", () => {
    const result = buildResumeCommand({ prompt: "before\nPROMPT_END\nafter" });
    expect(result).toContain("<<'PROMPT_END_'");
    expect(result).toContain("before\nPROMPT_END\nafter");
    expect(result).toMatch(/PROMPT_END_$/);
  });
});

// ============================================================================
// findSafeDelimiter tests
// ============================================================================

describe("findSafeDelimiter", () => {
  test("no collision - returns default PROMPT_END", () => {
    expect(findSafeDelimiter("normal prompt")).toBe("PROMPT_END");
  });

  test("PROMPT_END in content - appends underscore", () => {
    expect(findSafeDelimiter("before\nPROMPT_END\nafter")).toBe("PROMPT_END_");
  });

  test("multiple collisions - appends underscores until safe", () => {
    expect(findSafeDelimiter("PROMPT_END\nPROMPT_END_\nPROMPT_END__")).toBe("PROMPT_END___");
  });

  test("PROMPT_END as substring of a line - no collision", () => {
    expect(findSafeDelimiter("text PROMPT_END text")).toBe("PROMPT_END");
  });

  test("PROMPT_END with trailing whitespace - no collision", () => {
    expect(findSafeDelimiter("PROMPT_END ")).toBe("PROMPT_END");
  });

  test("PROMPT_END with leading whitespace - no collision", () => {
    expect(findSafeDelimiter("  PROMPT_END")).toBe("PROMPT_END");
  });

  test("PROMPT_END with CRLF line endings - no collision", () => {
    // \r is part of the line content after split("\n"), so "PROMPT_END\r" !== "PROMPT_END".
    // Bash heredoc also compares the delimiter exactly, so "PROMPT_END\r" won't terminate it.
    expect(findSafeDelimiter("PROMPT_END\r\n")).toBe("PROMPT_END");
  });

  test("empty content - returns default PROMPT_END", () => {
    expect(findSafeDelimiter("")).toBe("PROMPT_END");
  });
});
