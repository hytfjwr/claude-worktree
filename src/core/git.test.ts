import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createExecStub } from "../__test-utils__.ts";
import type { WorktreeInfo } from "../types/index.ts";
import { exec } from "./exec.ts";
import {
  buildWorktreeCommand,
  extractMainBranchName,
  getWorktreePath,
  isRemoteBranchDeletedFrom,
  parseAheadBehind,
  parseCommitLog,
  parseWorktreePorcelain,
} from "./git.ts";

// Hoisted mock for ./exec — default passthrough, overridable per-test via mockExecImpl
const { mockExecImpl } = vi.hoisted(() => ({
  mockExecImpl: { current: null as ((cmd: string, args: string[]) => unknown) | null },
}));

vi.mock("./exec.ts", async (importOriginal) => {
  const original = (await importOriginal()) as { exec: (cmd: string, args: string[]) => unknown };
  return {
    ...original,
    exec: (cmd: string, args: string[]) => {
      if (mockExecImpl.current) {
        return mockExecImpl.current(cmd, args);
      }
      return original.exec(cmd, args);
    },
  };
});

// ============================================================================
// Pure function tests (no mocks needed)
// ============================================================================

describe("getWorktreePath", () => {
  test("branch with slash - feature/test -> repo-feature-test", () => {
    const result = getWorktreePath("/path/to/repo", "repo", "feature/test");
    expect(result).toBe("/path/to/repo-feature-test");
  });

  test("multiple slashes - feature/auth/oauth -> repo-feature-auth-oauth", () => {
    const result = getWorktreePath("/path/to/repo", "repo", "feature/auth/oauth");
    expect(result).toBe("/path/to/repo-feature-auth-oauth");
  });

  test("no slash - main -> repo-main", () => {
    const result = getWorktreePath("/path/to/repo", "repo", "main");
    expect(result).toBe("/path/to/repo-main");
  });

  test("different repository name", () => {
    const result = getWorktreePath("/home/user/projects/my-app", "my-app", "fix/bug-123");
    expect(result).toBe("/home/user/projects/my-app-fix-bug-123");
  });

  test("branches differing only in / vs - produce the same path (collision scenario)", () => {
    const result1 = getWorktreePath("/path/to/repo", "repo", "feature/auth");
    const result2 = getWorktreePath("/path/to/repo", "repo", "feature-auth");
    expect(result1).toBe(result2);
    expect(result1).toBe("/path/to/repo-feature-auth");
  });
});

describe("buildWorktreeCommand", () => {
  test("basic command - correct git worktree add command generation", () => {
    const result = buildWorktreeCommand("feature/test", "/path/to/worktree", "main");
    expect(result).toBe('git worktree add -b feature/test "/path/to/worktree" main');
  });

  test("path with spaces - path is quoted", () => {
    const result = buildWorktreeCommand("feature/new", "/path with spaces/worktree", "develop");
    expect(result).toBe('git worktree add -b feature/new "/path with spaces/worktree" develop');
  });

  test("different base branch", () => {
    const result = buildWorktreeCommand("fix/issue", "/worktree/path", "develop");
    expect(result).toBe('git worktree add -b fix/issue "/worktree/path" develop');
  });
});

// ============================================================================
// parseWorktreePorcelain tests (pure function)
// ============================================================================

describe("parseWorktreePorcelain", () => {
  test("empty output - returns empty array", () => {
    const result = parseWorktreePorcelain("", "main");
    expect(result).toEqual([]);
  });

  test("whitespace only - returns empty array", () => {
    const result = parseWorktreePorcelain("  \n  ", "main");
    expect(result).toEqual([]);
  });

  test("single worktree - parses correctly", () => {
    const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "/path/to/repo",
      branch: "main",
      isLocked: false,
      isMain: true,
    });
  });

  test("multiple worktrees - parses all correctly", () => {
    const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main

worktree /path/to/repo-feature
HEAD def456
branch refs/heads/feature/test`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("/path/to/repo");
    expect(result[0].branch).toBe("main");
    expect(result[0].isMain).toBe(true);
    expect(result[1].path).toBe("/path/to/repo-feature");
    expect(result[1].branch).toBe("feature/test");
    expect(result[1].isMain).toBe(false);
  });

  test("locked attribute - isLocked: true", () => {
    const output = `worktree /path/to/locked
HEAD abc123
branch refs/heads/feature/locked
locked`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result[0].isLocked).toBe(true);
  });

  test("bare attribute - isMain: true (bare repository)", () => {
    const output = `worktree /path/to/bare
bare`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result[0].isMain).toBe(true);
    expect(result[0].branch).toBeNull();
  });

  test("branch refs/heads/ extraction - prefix removed", () => {
    const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/feature/deep/nested/branch`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result[0].branch).toBe("feature/deep/nested/branch");
  });

  test("main branch detection - specified branch is treated as main", () => {
    const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/develop`;

    // Specify develop as the main branch
    const result = parseWorktreePorcelain(output, "develop");

    expect(result[0].isMain).toBe(true);
  });

  test("detached HEAD - branch: null", () => {
    const output = `worktree /path/to/detached
HEAD abc123def456
detached`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result[0].branch).toBeNull();
    expect(result[0].isMain).toBe(false);
  });
});

// ============================================================================
// parseCommitLog tests (pure function)
// ============================================================================

describe("parseCommitLog", () => {
  test("parses commit info correctly", () => {
    const output = "abc123\x00Fix bug\x002025-01-15T10:30:00+09:00\n";
    const result = parseCommitLog(output);

    expect(result).not.toBeNull();
    expect(result?.hash).toBe("abc123");
    expect(result?.message).toBe("Fix bug");
    expect(result?.date).toEqual(new Date("2025-01-15T10:30:00+09:00"));
  });

  test("returns null on empty output", () => {
    expect(parseCommitLog("")).toBeNull();
  });

  test("returns null on whitespace only", () => {
    expect(parseCommitLog("  \n  ")).toBeNull();
  });

  test("returns null on incomplete output (missing date field)", () => {
    expect(parseCommitLog("abc123\x00Fix bug\n")).toBeNull();
  });

  test("returns null on single field only", () => {
    expect(parseCommitLog("abc123\n")).toBeNull();
  });
});

// ============================================================================
// parseAheadBehind tests (pure function)
// ============================================================================

describe("parseAheadBehind", () => {
  test("parses ahead/behind counts correctly", () => {
    const result = parseAheadBehind("3\t1\n");
    expect(result).toEqual({ ahead: 3, behind: 1 });
  });

  test("handles spaces as separator", () => {
    const result = parseAheadBehind("5  2\n");
    expect(result).toEqual({ ahead: 5, behind: 2 });
  });

  test("returns null on malformed output (single value)", () => {
    expect(parseAheadBehind("unexpected output\n")).toBeNull();
  });

  test("returns null on empty output", () => {
    expect(parseAheadBehind("")).toBeNull();
  });

  test("returns null on three values", () => {
    expect(parseAheadBehind("1\t2\t3\n")).toBeNull();
  });
});

// ============================================================================
// extractMainBranchName tests (pure function)
// ============================================================================

describe("extractMainBranchName", () => {
  test("detects main from branch list", () => {
    const branchList = "  remotes/origin/main\n  remotes/origin/develop\n";
    expect(extractMainBranchName(branchList)).toBe("main");
  });

  test("detects master when no main branch", () => {
    const branchList = "  remotes/origin/master\n";
    expect(extractMainBranchName(branchList)).toBe("master");
  });

  test("prefers main over master", () => {
    const branchList = "  remotes/origin/main\n  remotes/origin/master\n";
    expect(extractMainBranchName(branchList)).toBe("main");
  });

  test("does not falsely match 'maintenance' as main branch", () => {
    const branchList = "* maintenance\n  remotes/origin/maintenance\n  remotes/origin/master\n";
    expect(extractMainBranchName(branchList)).toBe("master");
  });

  test("does not falsely match 'mainly-refactor' or 'domain/maintenance'", () => {
    const branchList =
      "  mainly-refactor\n  remotes/origin/mainly-refactor\n  remotes/origin/domain/maintenance\n  remotes/origin/master\n";
    expect(extractMainBranchName(branchList)).toBe("master");
  });

  test("returns main as ultimate fallback when neither main nor master exists", () => {
    const branchList = "  develop\n  remotes/origin/develop\n";
    expect(extractMainBranchName(branchList)).toBe("main");
  });

  test("detects local main branch (without remotes/ prefix)", () => {
    const branchList = "* main\n  develop\n";
    expect(extractMainBranchName(branchList)).toBe("main");
  });

  test("detects local master branch (without remotes/ prefix)", () => {
    const branchList = "* master\n  develop\n";
    expect(extractMainBranchName(branchList)).toBe("master");
  });
});

// ============================================================================
// isRemoteBranchDeletedFrom tests (pure function)
// ============================================================================

describe("isRemoteBranchDeletedFrom", () => {
  test("branch exists on remote - false", () => {
    const tracked = new Set(["main", "feature/test"]);
    const remote = new Set(["main", "feature/test"]);
    expect(isRemoteBranchDeletedFrom("feature/test", tracked, remote)).toBe(false);
  });

  test("branch deleted from remote - true", () => {
    const tracked = new Set(["main", "feature/deleted"]);
    const remote = new Set(["main"]);
    expect(isRemoteBranchDeletedFrom("feature/deleted", tracked, remote)).toBe(true);
  });

  test("branch never tracked - false", () => {
    const tracked = new Set(["main"]);
    const remote = new Set(["main"]);
    expect(isRemoteBranchDeletedFrom("feature/local-only", tracked, remote)).toBe(false);
  });

  test("empty tracked set - always false", () => {
    expect(isRemoteBranchDeletedFrom("feature/test", new Set(), new Set())).toBe(false);
  });
});

// ============================================================================
// Mock-based tests (error handling / orchestration)
// ============================================================================

describe("getGitContext", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("correctly retrieves repository info", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--show-toplevel")) {
        return { stdout: "/path/to/my-repo\n" };
      }
      if (args.includes("--show-current")) {
        return { stdout: "feature/test\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getGitContext } = await import("./git.ts");
    const context = await getGitContext();

    expect(context.repoRoot).toBe("/path/to/my-repo");
    expect(context.repoName).toBe("my-repo");
    expect(context.currentBranch).toBe("feature/test");
  });

  test("throws error when not in a git repository", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--show-toplevel")) {
        return { stdout: "", stderr: "fatal: not a git repository", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getGitContext } = await import("./git.ts");
    await expect(getGitContext()).rejects.toThrow("Not in a git repository");
  });

  test("throws error on detached HEAD", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--show-toplevel")) {
        return { stdout: "/path/to/repo\n" };
      }
      if (args.includes("--show-current")) {
        return { stdout: "\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getGitContext } = await import("./git.ts");
    await expect(getGitContext()).rejects.toThrow("detached HEAD");
  });
});

describe("getMainBranch", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns main from symbolic-ref", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git.ts");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("main");
  });

  test("falls back to branch list when symbolic-ref fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 128 };
      }
      if (args.includes("-a")) {
        return { stdout: "  remotes/origin/master\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git.ts");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("master");
  });

  test("returns main as default when both symbolic-ref and branch list fail", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 128 };
      }
      if (args.includes("-a")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git.ts");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("main");
  });
});

describe("isWorktreeDirty", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("clean worktree - false", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("status")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isWorktreeDirty } = await import("./git.ts");
    const isDirty = await isWorktreeDirty("/path/to/worktree");

    expect(isDirty).toBe(false);
  });

  test("dirty worktree - true", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("status")) {
        return { stdout: " M src/index.ts\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isWorktreeDirty } = await import("./git.ts");
    const isDirty = await isWorktreeDirty("/path/to/worktree");

    expect(isDirty).toBe(true);
  });

  test("treats as dirty when git status fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("status")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isWorktreeDirty } = await import("./git.ts");
    const isDirty = await isWorktreeDirty("/path/to/worktree");

    expect(isDirty).toBe(true);
  });
});

describe("isBranchMerged", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("merged branch - true", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--merged")) {
        return { stdout: "  main\n  feature/completed\n" };
      }
      // getMainBranch fallback
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isBranchMerged } = await import("./git.ts");
    const isMerged = await isBranchMerged("feature/completed", "main");

    expect(isMerged).toBe(true);
  });

  test("unmerged branch - false", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--merged")) {
        return { stdout: "  main\n" };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isBranchMerged } = await import("./git.ts");
    const isMerged = await isBranchMerged("feature/in-progress", "main");

    expect(isMerged).toBe(false);
  });

  test("returns false when git command fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--merged")) {
        return { stdout: "", exitCode: 128 };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isBranchMerged } = await import("./git.ts");
    const isMerged = await isBranchMerged("feature/test", "main");

    expect(isMerged).toBe(false);
  });
});

describe("getRemoteTrackingBranches", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns set of remote tracking branches", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("for-each-ref")) {
        return { stdout: "origin/main\norigin/feature/test\norigin/develop\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getRemoteTrackingBranches } = await import("./git.ts");
    const branches = await getRemoteTrackingBranches();

    expect(branches).toEqual(new Set(["main", "feature/test", "develop"]));
  });

  test("excludes HEAD pointer", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("for-each-ref")) {
        return { stdout: "origin/HEAD\norigin/main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getRemoteTrackingBranches } = await import("./git.ts");
    const branches = await getRemoteTrackingBranches();

    expect(branches).toEqual(new Set(["main"]));
    expect(branches.has("HEAD")).toBe(false);
  });

  test("returns empty set when command fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("for-each-ref")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getRemoteTrackingBranches } = await import("./git.ts");
    const branches = await getRemoteTrackingBranches();

    expect(branches).toEqual(new Set());
  });

  test("returns empty set on empty output", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("for-each-ref")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getRemoteTrackingBranches } = await import("./git.ts");
    const branches = await getRemoteTrackingBranches();

    expect(branches).toEqual(new Set());
  });
});

describe("isRemoteBranchDeleted", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("branch exists on remote - false", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "abc123\trefs/heads/main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git.ts");
    const tracked = new Set(["main"]);
    const isDeleted = await isRemoteBranchDeleted("main", tracked);

    expect(isDeleted).toBe(false);
  });

  test("branch deleted from remote - true", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git.ts");
    const tracked = new Set(["feature/deleted"]);
    const isDeleted = await isRemoteBranchDeleted("feature/deleted", tracked);

    expect(isDeleted).toBe(true);
  });

  test("assumes deleted when ls-remote fails for tracked branch", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git.ts");
    const tracked = new Set(["feature/test"]);
    const isDeleted = await isRemoteBranchDeleted("feature/test", tracked);

    expect(isDeleted).toBe(true);
  });

  test("branch never pushed to remote - false (not remote deleted)", async () => {
    // ls-remote should NOT be called for untracked branches
    let lsRemoteCalled = false;
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        lsRemoteCalled = true;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git.ts");
    const tracked = new Set(["main", "develop"]);
    const isDeleted = await isRemoteBranchDeleted("feature/new-local", tracked);

    expect(isDeleted).toBe(false);
    expect(lsRemoteCalled).toBe(false);
  });

  test("empty trackedBranches set - always false", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git.ts");
    const isDeleted = await isRemoteBranchDeleted("feature/test", new Set());

    expect(isDeleted).toBe(false);
  });
});

describe("getRemoteBranches", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns set of remote branch names", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote") && args.includes("--heads")) {
        return {
          stdout: "abc123\trefs/heads/main\ndef456\trefs/heads/feature/test\nghi789\trefs/heads/develop\n",
        };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getRemoteBranches } = await import("./git.ts");
    const branches = await getRemoteBranches();

    expect(branches).toEqual(new Set(["main", "feature/test", "develop"]));
  });

  test("returns empty set when command fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getRemoteBranches } = await import("./git.ts");
    const branches = await getRemoteBranches();

    expect(branches).toEqual(new Set());
  });

  test("returns empty set on empty output", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote") && args.includes("--heads")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getRemoteBranches } = await import("./git.ts");
    const branches = await getRemoteBranches();

    expect(branches).toEqual(new Set());
  });
});

describe("listWorktrees", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("retrieves and parses worktree list", async () => {
    const porcelainOutput = [
      "worktree /path/to/repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /path/to/repo-feature",
      "HEAD def456",
      "branch refs/heads/feature/test",
    ].join("\n");

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("list")) {
        return { stdout: porcelainOutput };
      }
      // getMainBranch
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      // isWorktreeDirty
      if (args.includes("status")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listWorktrees } = await import("./git.ts");
    const { worktrees, mainBranch } = await listWorktrees();

    expect(mainBranch).toBe("main");
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].branch).toBe("main");
    expect(worktrees[0].isMain).toBe(true);
    expect(worktrees[1].branch).toBe("feature/test");
    expect(worktrees[1].isMain).toBe(false);
  });

  test("empty worktree list", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("list")) {
        return { stdout: "" };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listWorktrees } = await import("./git.ts");
    const { worktrees } = await listWorktrees();

    expect(worktrees).toHaveLength(0);
  });

  test("throws when git worktree list fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("list")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { listWorktrees } = await import("./git.ts");
    await expect(listWorktrees()).rejects.toThrow("Failed to list worktrees");
  });
});

describe("findWorktreeByBranch", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("finds existing branch", async () => {
    const porcelainOutput = [
      "worktree /path/to/repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /path/to/repo-feature",
      "HEAD def456",
      "branch refs/heads/feature/test",
    ].join("\n");

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("list")) {
        return { stdout: porcelainOutput };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("status")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { findWorktreeByBranch } = await import("./git.ts");
    const worktree = await findWorktreeByBranch("feature/test");

    expect(worktree).not.toBeNull();
    expect(worktree?.branch).toBe("feature/test");
    expect(worktree?.path).toBe("/path/to/repo-feature");
  });

  test("non-existent branch returns null", async () => {
    const porcelainOutput = ["worktree /path/to/repo", "HEAD abc123", "branch refs/heads/main"].join("\n");

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--porcelain") && args.includes("list")) {
        return { stdout: porcelainOutput };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("status")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { findWorktreeByBranch } = await import("./git.ts");
    const worktree = await findWorktreeByBranch("nonexistent-branch");

    expect(worktree).toBeNull();
  });
});

describe("deleteLocalBranch", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("throws error on failure", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("-d") || args.includes("-D")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { deleteLocalBranch } = await import("./git.ts");
    await expect(deleteLocalBranch("nonexistent-branch")).rejects.toThrow("Failed to delete branch");
  });
});

describe("fetchOrigin", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("throws error when fetch fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("fetch")) {
        return { stdout: "", stderr: "fatal: could not read from remote", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { fetchOrigin } = await import("./git.ts");
    await expect(fetchOrigin("main")).rejects.toThrow("Failed to fetch from origin");
  });
});

describe("getUnpushedCommitCount", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns count when origin/<branch> exists", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-list") && args.includes("--count")) {
        return { stdout: "3\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getUnpushedCommitCount } = await import("./git.ts");
    const count = await getUnpushedCommitCount("/path/to/wt", "feature/test");
    expect(count).toBe(3);
  });

  test("returns 0 when all commits are pushed", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-list") && args.includes("--count")) {
        return { stdout: "0\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getUnpushedCommitCount } = await import("./git.ts");
    const count = await getUnpushedCommitCount("/path/to/wt", "feature/test");
    expect(count).toBe(0);
  });

  test("returns null when origin/<branch> does not exist", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-list") && args.includes("--count")) {
        return { stdout: "", exitCode: 128, stderr: "fatal: bad revision" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getUnpushedCommitCount } = await import("./git.ts");
    const count = await getUnpushedCommitCount("/path/to/wt", "feature/test");
    expect(count).toBeNull();
  });
});

describe("getLastCommit", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns null when git log fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("log")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getLastCommit } = await import("./git.ts");
    const commit = await getLastCommit("/path/to/wt");
    expect(commit).toBeNull();
  });
});

describe("getAheadBehind", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns null when rev-list fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-list")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getAheadBehind } = await import("./git.ts");
    const result = await getAheadBehind("feature/test", "main");
    expect(result).toBeNull();
  });
});

describe("verifyBranchRef", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns true when ref exists", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-parse") && args.includes("--verify")) {
        return { stdout: "abc123\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { verifyBranchRef } = await import("./git.ts");
    const result = await verifyBranchRef("origin/main");
    expect(result).toBe(true);
  });

  test("returns false when ref does not exist", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-parse") && args.includes("--verify")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { verifyBranchRef } = await import("./git.ts");
    const result = await verifyBranchRef("nonexistent-ref");
    expect(result).toBe(false);
  });
});

// ============================================================================
// getWorktreeStatuses tests (pure logic tests)
// ============================================================================

describe("getWorktreeStatuses", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });

  afterEach(() => {
    mockExecImpl.current = null;
  });

  function createWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
    return {
      path: "/path/to/worktree",
      branch: "feature/test",
      isLocked: false,
      isDirty: false,
      isMain: false,
      ...overrides,
    };
  }

  // Default tracked branches set including "feature/test" (the default branch in createWorktree)
  const defaultTracked = new Set(["feature/test"]);

  // Helper to set exec mock for controlling isBranchMerged/isRemoteBranchDeleted behavior.
  // vi.doMock("./git") cannot intercept intra-module calls in Vitest, so we mock exec instead.
  function setExecMockForStatuses(config: { branchMerged: boolean; remoteBranchDeleted: boolean }) {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--merged")) {
        return { stdout: config.branchMerged ? "  main\n  feature/test\n" : "  main\n" };
      }
      if (args.includes("ls-remote")) {
        return { stdout: config.remoteBranchDeleted ? "" : "abc123\trefs/heads/feature/test\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });
  }

  test("main worktree has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isMain: true, branch: "main" });
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Main worktree");
  });

  test("locked worktree has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isLocked: true });
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Locked");
  });

  test("dirty worktree with active branch has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Has uncommitted changes");
  });

  test("dirty worktree with remote deleted branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].branchDeletedOnRemote).toBe(true);
    expect(statuses[0].reason).toBe("Remote deleted (dirty)");
  });

  test("dirty worktree with merged branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].branchMerged).toBe(true);
    expect(statuses[0].reason).toBe("Merged (dirty)");
  });

  test("dirty worktree with merged & remote deleted has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Merged & remote deleted (dirty)");
  });

  test("dirty worktree never pushed to remote has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isDirty: true, branch: "feature/new-local" });
    // trackedBranches does NOT include "feature/new-local"
    const tracked = new Set(["main", "develop"]);
    const statuses = await getWorktreeStatuses([worktree], "main", tracked);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Has uncommitted changes");
  });

  test("condition priority: isMain > isLocked > isDirty", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");

    // isMain takes highest priority
    const mainAndLocked = createWorktree({ isMain: true, isLocked: true, isDirty: true });
    const statusMain = await getWorktreeStatuses([mainAndLocked], "main");
    expect(statusMain[0].reason).toBe("Main worktree");

    // isLocked takes next priority
    const lockedAndDirty = createWorktree({ isLocked: true, isDirty: true });
    const statusLocked = await getWorktreeStatuses([lockedAndDirty], "main");
    expect(statusLocked[0].reason).toBe("Locked");
  });

  test("null branch does not cause error", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ branch: null });
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses).toHaveLength(1);
    expect(statuses[0].branchMerged).toBe(false);
    expect(statuses[0].branchDeletedOnRemote).toBe(false);
  });

  test("merged branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Merged");
  });

  test("remote deleted branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Remote deleted");
  });

  test("merged & remote deleted", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Merged & remote deleted");
  });

  test("active branch has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main", defaultTracked);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Active");
  });

  test("branch not in trackedBranches is not marked as remote deleted", async () => {
    // Even though ls-remote returns empty (branch doesn't exist on remote),
    // if the branch was never tracked, it should NOT be "Remote deleted"
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ branch: "feature/new-local" });
    // trackedBranches does NOT include "feature/new-local"
    const tracked = new Set(["main", "develop"]);
    const statuses = await getWorktreeStatuses([worktree], "main", tracked);

    expect(statuses[0].branchDeletedOnRemote).toBe(false);
    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Active");
  });

  test("without trackedBranches, branch is not marked as remote deleted", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree();
    // No trackedBranches passed (undefined)
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].branchDeletedOnRemote).toBe(false);
    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Active");
  });

  test("uses batched remoteBranches when provided (no ls-remote calls)", async () => {
    let lsRemoteCalled = false;
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        lsRemoteCalled = true;
        return { stdout: "" };
      }
      if (args.includes("--merged")) {
        return { stdout: "  main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree();
    const tracked = new Set(["feature/test"]);
    const remote = new Set(["main"]); // feature/test not on remote => deleted

    const statuses = await getWorktreeStatuses([worktree], "main", tracked, remote);

    expect(lsRemoteCalled).toBe(false);
    expect(statuses[0].branchDeletedOnRemote).toBe(true);
    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Remote deleted");
  });

  test("batched remoteBranches: branch exists on remote", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--merged")) {
        return { stdout: "  main\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree();
    const tracked = new Set(["feature/test"]);
    const remote = new Set(["main", "feature/test"]); // feature/test exists on remote

    const statuses = await getWorktreeStatuses([worktree], "main", tracked, remote);

    expect(statuses[0].branchDeletedOnRemote).toBe(false);
    expect(statuses[0].reason).toBe("Active");
  });
});

// ============================================================================
// Integration tests (real git repositories)
// ============================================================================

/**
 * Create a temporary git repository with an initial commit.
 * For tests requiring a remote, a bare repo is set up as origin.
 */
async function setupTestRepo(options?: { withRemote?: boolean }) {
  const tempDir = await mkdtemp(join(tmpdir(), "git-test-"));
  const repoDir = join(tempDir, "repo");

  if (options?.withRemote) {
    const bareDir = join(tempDir, "origin.git");
    await exec("git", ["init", "--bare", "--initial-branch=main", bareDir]).quiet();
    await exec("git", ["clone", bareDir, repoDir]).quiet();
  } else {
    await exec("git", ["init", "--initial-branch=main", repoDir]).quiet();
  }

  // Configure git user and disable GPG signing for test commits
  await exec("git", ["-C", repoDir, "config", "user.email", "test@test.com"]).quiet();
  await exec("git", ["-C", repoDir, "config", "user.name", "Test"]).quiet();
  await exec("git", ["-C", repoDir, "config", "commit.gpgsign", "false"]).quiet();

  // Create initial commit
  await exec("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "initial commit"]).quiet();

  if (options?.withRemote) {
    await exec("git", ["-C", repoDir, "push", "-u", "origin", "main"]).quiet();
  }

  return {
    tempDir,
    repoDir,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

// Integration tests use two CWD mechanisms:
// - process.chdir(repoDir): required because functions under test (createWorktree, fetchAndPrune, etc.)
//   call exec("git", [...]) internally without .cwd(), relying on process.cwd()
// - git() helper with .cwd(repoDir): used for direct exec calls in test bodies (setup/verification)
//   to explicitly target the temp repo regardless of process CWD state

describe("createWorktree (integration)", () => {
  let cleanup: () => Promise<void>;
  let repoDir: string;
  let originalCwd: string;
  function git(args: string[]) {
    return exec("git", args).cwd(repoDir);
  }

  beforeEach(async () => {
    originalCwd = process.cwd();
    const setup = await setupTestRepo();
    cleanup = setup.cleanup;
    repoDir = setup.repoDir;
    process.chdir(repoDir);
    vi.resetModules();
    mockExecImpl.current = null;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExecImpl.current = null;
    await cleanup();
  });

  test("creates worktree and branch in real git repo", async () => {
    const { createWorktree } = await import("./git.ts");
    const worktreePath = join(repoDir, "..", "test-worktree");

    await createWorktree("feature/new", worktreePath, "main");

    // Verify worktree exists in git worktree list
    const listResult = (await git(["worktree", "list", "--porcelain"]).text()).trim();
    expect(listResult).toContain(worktreePath);

    // Verify branch was created
    const branchResult = (await exec("git", ["-C", worktreePath, "branch", "--show-current"]).text()).trim();
    expect(branchResult).toBe("feature/new");
  });

  test("throws when branch already exists", async () => {
    const { createWorktree } = await import("./git.ts");
    const worktreePath = join(repoDir, "..", "test-worktree");

    // Create branch first
    await git(["branch", "feature/existing"]).quiet();

    await expect(createWorktree("feature/existing", worktreePath, "main")).rejects.toThrow("Failed to create worktree");
  });
});

describe("removeWorktree (integration)", () => {
  let cleanup: () => Promise<void>;
  let repoDir: string;
  let originalCwd: string;
  function git(args: string[]) {
    return exec("git", args).cwd(repoDir);
  }

  beforeEach(async () => {
    originalCwd = process.cwd();
    const setup = await setupTestRepo();
    cleanup = setup.cleanup;
    repoDir = setup.repoDir;
    process.chdir(repoDir);
    vi.resetModules();
    mockExecImpl.current = null;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExecImpl.current = null;
    await cleanup();
  });

  test("removes worktree from real git repo", async () => {
    const worktreePath = join(repoDir, "..", "test-worktree");

    // Create a worktree first
    await git(["worktree", "add", "-b", "feature/to-remove", worktreePath, "main"]).quiet();

    const { removeWorktree } = await import("./git.ts");
    await removeWorktree(worktreePath);

    // Verify worktree is gone
    const listResult = (await git(["worktree", "list", "--porcelain"]).text()).trim();
    expect(listResult).not.toContain(worktreePath);
  });

  test("force removes dirty worktree", async () => {
    const worktreePath = join(repoDir, "..", "test-worktree");

    // Create a worktree and make it dirty
    await git(["worktree", "add", "-b", "feature/dirty", worktreePath, "main"]).quiet();
    await writeFile(join(worktreePath, "dirty.txt"), "uncommitted change");

    const { removeWorktree } = await import("./git.ts");
    await removeWorktree(worktreePath, true);

    // Verify worktree is gone
    const listResult = (await git(["worktree", "list", "--porcelain"]).text()).trim();
    expect(listResult).not.toContain(worktreePath);
  });
});

describe("deleteLocalBranch (integration)", () => {
  let cleanup: () => Promise<void>;
  let repoDir: string;
  let originalCwd: string;
  function git(args: string[]) {
    return exec("git", args).cwd(repoDir);
  }

  beforeEach(async () => {
    originalCwd = process.cwd();
    const setup = await setupTestRepo();
    cleanup = setup.cleanup;
    repoDir = setup.repoDir;
    process.chdir(repoDir);
    vi.resetModules();
    mockExecImpl.current = null;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExecImpl.current = null;
    await cleanup();
  });

  test("deletes merged branch with -d (default)", async () => {
    // Create and merge a branch
    await git(["branch", "feature/merged"]).quiet();

    const { deleteLocalBranch } = await import("./git.ts");
    await deleteLocalBranch("feature/merged");

    // Verify branch is gone
    const result = await git(["show-ref", "--verify", "--quiet", "refs/heads/feature/merged"]).nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
  });

  test("force deletes unmerged branch with -D", async () => {
    // Create a branch with a unique commit (not merged into main)
    await git(["checkout", "-b", "feature/unmerged"]).quiet();
    await git(["commit", "--allow-empty", "-m", "unmerged commit"]).quiet();
    await git(["checkout", "main"]).quiet();

    const { deleteLocalBranch } = await import("./git.ts");
    await deleteLocalBranch("feature/unmerged", true);

    // Verify branch is gone
    const result = await git(["show-ref", "--verify", "--quiet", "refs/heads/feature/unmerged"]).nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
  });

  test("non-force delete of unmerged branch fails", async () => {
    // Create a branch with a unique commit (not merged into main)
    await git(["checkout", "-b", "feature/unmerged"]).quiet();
    await git(["commit", "--allow-empty", "-m", "unmerged commit"]).quiet();
    await git(["checkout", "main"]).quiet();

    const { deleteLocalBranch } = await import("./git.ts");
    await expect(deleteLocalBranch("feature/unmerged")).rejects.toThrow("Failed to delete branch");
  });
});

describe("fetchAndPrune (integration)", () => {
  let cleanup: () => Promise<void>;
  let repoDir: string;
  let tempDir: string;
  let originalCwd: string;
  function git(args: string[]) {
    return exec("git", args).cwd(repoDir);
  }

  beforeEach(async () => {
    originalCwd = process.cwd();
    const setup = await setupTestRepo({ withRemote: true });
    cleanup = setup.cleanup;
    repoDir = setup.repoDir;
    tempDir = setup.tempDir;
    process.chdir(repoDir);
    vi.resetModules();
    mockExecImpl.current = null;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExecImpl.current = null;
    await cleanup();
  });

  test("prunes deleted remote branches", async () => {
    const bareDir = join(tempDir, "origin.git");

    // Create a remote branch
    await git(["checkout", "-b", "feature/to-prune"]).quiet();
    await git(["commit", "--allow-empty", "-m", "branch commit"]).quiet();
    await git(["push", "-u", "origin", "feature/to-prune"]).quiet();
    await git(["checkout", "main"]).quiet();

    // Verify remote tracking exists
    const beforeRefs = (await git(["branch", "-r"]).text()).trim();
    expect(beforeRefs).toContain("origin/feature/to-prune");

    // Delete branch on bare remote directly
    await exec("git", ["-C", bareDir, "branch", "-D", "feature/to-prune"]).quiet();

    // fetchAndPrune should clean up the stale remote tracking branch
    const { fetchAndPrune } = await import("./git.ts");
    await fetchAndPrune();

    // Verify remote tracking is gone
    const afterRefs = (await git(["branch", "-r"]).text()).trim();
    expect(afterRefs).not.toContain("origin/feature/to-prune");
  });
});

describe("branchExists (integration)", () => {
  let cleanup: () => Promise<void>;
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    const setup = await setupTestRepo();
    cleanup = setup.cleanup;
    repoDir = setup.repoDir;
    process.chdir(repoDir);
    vi.resetModules();
    mockExecImpl.current = null;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExecImpl.current = null;
    await cleanup();
  });

  test("returns true for existing branch", async () => {
    const { branchExists } = await import("./git.ts");
    const exists = await branchExists("main");
    expect(exists).toBe(true);
  });

  test("returns false for non-existent branch", async () => {
    const { branchExists } = await import("./git.ts");
    const exists = await branchExists("nonexistent-branch");
    expect(exists).toBe(false);
  });
});
