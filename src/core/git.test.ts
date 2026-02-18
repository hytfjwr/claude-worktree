import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createExecStub } from "../__test-utils__.ts";
import type { WorktreeInfo } from "../types/index.ts";
import { buildWorktreeCommand, getWorktreePath, parseWorktreePorcelain } from "./git.ts";

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
// Tests for functions using shell commands (using mocks)
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

  test("falls back to master when symbolic-ref fails and no main branch", async () => {
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

  test("detects main from branch list when symbolic-ref fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 128 };
      }
      if (args.includes("-a")) {
        return { stdout: "  remotes/origin/main\n  remotes/origin/develop\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git.ts");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("main");
  });

  test("does not falsely match 'maintenance' as main branch", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 128 };
      }
      if (args.includes("-a")) {
        return { stdout: "* maintenance\n  remotes/origin/maintenance\n  remotes/origin/master\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git.ts");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("master");
  });

  test("does not falsely match 'mainly-refactor' or 'domain/maintenance'", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 128 };
      }
      if (args.includes("-a")) {
        return {
          stdout:
            "  mainly-refactor\n  remotes/origin/mainly-refactor\n  remotes/origin/domain/maintenance\n  remotes/origin/master\n",
        };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git.ts");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("master");
  });

  test("returns main as ultimate fallback when neither main nor master exists", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 128 };
      }
      if (args.includes("-a")) {
        return { stdout: "  develop\n  remotes/origin/develop\n" };
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

  test("passes worktree path via -C flag", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("status")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { isWorktreeDirty } = await import("./git.ts");
    await isWorktreeDirty("/my/worktree");

    expect(capturedArgs).toContain("-C");
    expect(capturedArgs).toContain("/my/worktree");
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

  test("branch deletion succeeds", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("-d") || args.includes("-D")) {
        return { stdout: "Deleted branch feature/old\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { deleteLocalBranch } = await import("./git.ts");
    await expect(deleteLocalBranch("feature/old")).resolves.toBeUndefined();
  });

  test("deleting non-existent branch throws error", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("-d") || args.includes("-D")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { deleteLocalBranch } = await import("./git.ts");
    await expect(deleteLocalBranch("nonexistent-branch")).rejects.toThrow("Failed to delete branch");
  });

  test("uses -d flag by default", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("-d") || args.includes("-D")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { deleteLocalBranch } = await import("./git.ts");
    await deleteLocalBranch("feature/old");

    expect(capturedArgs).toContain("-d");
    expect(capturedArgs).not.toContain("-D");
  });

  test("uses -D flag when force is true", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("-d") || args.includes("-D")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { deleteLocalBranch } = await import("./git.ts");
    await deleteLocalBranch("feature/old", true);

    expect(capturedArgs).toContain("-D");
    expect(capturedArgs).not.toContain("-d");
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

  test("fetches specific branch from origin", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("fetch")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { fetchOrigin } = await import("./git.ts");
    await fetchOrigin("main");

    expect(capturedArgs).toEqual(["fetch", "origin", "main"]);
  });

  test("fetches all from origin when no branch specified", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("fetch")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { fetchOrigin } = await import("./git.ts");
    await fetchOrigin();

    expect(capturedArgs).toEqual(["fetch", "origin"]);
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

describe("branchExists", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns true when branch exists", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("show-ref")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { branchExists } = await import("./git.ts");
    const exists = await branchExists("main");

    expect(exists).toBe(true);
  });

  test("returns false for non-existent branch", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("show-ref")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { branchExists } = await import("./git.ts");
    const exists = await branchExists("nonexistent-branch");

    expect(exists).toBe(false);
  });

  test("passes correct ref path", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("show-ref")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { branchExists } = await import("./git.ts");
    await branchExists("feature/test");

    expect(capturedArgs).toContain("refs/heads/feature/test");
  });
});

describe("createWorktree", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("succeeds when git worktree add exits with 0", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("worktree") && args.includes("add")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createWorktree } = await import("./git.ts");
    await expect(createWorktree("feature/new", "/path/to/wt", "main")).resolves.toBeUndefined();
    expect(capturedArgs).toEqual(["worktree", "add", "-b", "feature/new", "/path/to/wt", "main"]);
  });

  test("throws when git worktree add fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("worktree") && args.includes("add")) {
        return { stdout: "", stderr: "fatal: 'feature/new' already exists", exitCode: 128 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { createWorktree } = await import("./git.ts");
    await expect(createWorktree("feature/new", "/path/to/wt", "main")).rejects.toThrow(
      "Failed to create worktree: fatal: 'feature/new' already exists",
    );
  });
});

describe("removeWorktree", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("removes worktree without force", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("worktree") && args.includes("remove")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { removeWorktree } = await import("./git.ts");
    await removeWorktree("/path/to/wt");
    expect(capturedArgs).toEqual(["worktree", "remove", "/path/to/wt"]);
    expect(capturedArgs).not.toContain("--force");
  });

  test("removes worktree with force flag", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("worktree") && args.includes("remove")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { removeWorktree } = await import("./git.ts");
    await removeWorktree("/path/to/wt", true);
    expect(capturedArgs).toEqual(["worktree", "remove", "--force", "/path/to/wt"]);
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

  test("parses commit info correctly", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("log")) {
        return { stdout: "abc123\x00Fix bug\x002025-01-15T10:30:00+09:00\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getLastCommit } = await import("./git.ts");
    const commit = await getLastCommit("/path/to/wt");

    expect(commit).not.toBeNull();
    expect(commit?.hash).toBe("abc123");
    expect(commit?.message).toBe("Fix bug");
    expect(commit?.date).toEqual(new Date("2025-01-15T10:30:00+09:00"));
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

  test("returns null on empty output", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("log")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getLastCommit } = await import("./git.ts");
    const commit = await getLastCommit("/path/to/wt");
    expect(commit).toBeNull();
  });

  test("returns null on incomplete output (missing fields)", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("log")) {
        return { stdout: "abc123\x00Fix bug\n" }; // missing date field
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

  test("parses ahead/behind counts correctly", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-list")) {
        return { stdout: "3\t1\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getAheadBehind } = await import("./git.ts");
    const result = await getAheadBehind("feature/test", "main");

    expect(result).toEqual({ ahead: 3, behind: 1 });
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

  test("returns null on malformed output", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("rev-list")) {
        return { stdout: "unexpected output\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getAheadBehind } = await import("./git.ts");
    const result = await getAheadBehind("feature/test", "main");
    expect(result).toBeNull();
  });
});

describe("fetchAndPrune", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("calls git fetch --prune", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("fetch")) {
        capturedArgs = args;
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { fetchAndPrune } = await import("./git.ts");
    await expect(fetchAndPrune()).resolves.toBeUndefined();
    expect(capturedArgs).toEqual(["fetch", "--prune"]);
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

  test("dirty worktree has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git.ts");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree], "main");

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
});
