import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { WorktreeInfo } from "../types.ts";
import type { ExecResult } from "./exec.ts";
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

/**
 * Create a fake ExecBuilder that mirrors the real exec() return type contract.
 * - Awaiting returns ExecResult (with sync .text())
 * - .text() on builder returns Promise<string>
 * - .nothrow() / .quiet() are chainable no-ops
 * Throws for unhandled commands to catch regressions early.
 */
function createExecStub(handler: (cmd: string, args: string[]) => { stdout: string; exitCode?: number }) {
  return (cmd: string, args: string[]) => {
    const { stdout, exitCode = 0 } = handler(cmd, args);
    const result: ExecResult = {
      exitCode,
      stdout: Buffer.from(stdout),
      stderr: Buffer.alloc(0),
      text: () => stdout,
    };
    const builder = {
      nothrow() {
        return this;
      },
      quiet() {
        return this;
      },
      text: () => Promise.resolve(stdout),
      // biome-ignore lint/suspicious/noThenProperty: intentional PromiseLike implementation for exec stub
      then(resolve?: ((value: ExecResult) => unknown) | null, reject?: ((reason: unknown) => unknown) | null) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  };
}

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
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { getGitContext } = await import("./git");
    const context = await getGitContext();

    expect(context.repoRoot).toBe("/path/to/my-repo");
    expect(context.repoName).toBe("my-repo");
    expect(context.currentBranch).toBe("feature/test");
  });

  test("throws when not in a git repository", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--show-toplevel")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { getGitContext } = await import("./git");
    await expect(getGitContext()).rejects.toThrow();
  });

  test("throws when in detached HEAD state", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("--show-toplevel")) {
        return { stdout: "/path/to/repo\n" };
      }
      if (args.includes("--show-current")) {
        return { stdout: "\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { getGitContext } = await import("./git");
    await expect(getGitContext()).rejects.toThrow("Could not determine current branch");
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

  test("returns main when symbolic-ref points to origin/main", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git");
    expect(await getMainBranch()).toBe("main");
  });

  test("returns master when symbolic-ref points to origin/master", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/master\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git");
    expect(await getMainBranch()).toBe("master");
  });

  test("falls back to branch list when symbolic-ref fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 1 };
      }
      if (args.includes("-a")) {
        return { stdout: "  main\n  remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git");
    expect(await getMainBranch()).toBe("main");
  });

  test("returns master when no main branch in branch list", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "", exitCode: 1 };
      }
      if (args.includes("-a")) {
        return { stdout: "  remotes/origin/master\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { getMainBranch } = await import("./git");
    expect(await getMainBranch()).toBe("master");
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

  test("clean worktree returns false", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("status") && args.includes("--porcelain")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isWorktreeDirty } = await import("./git");
    expect(await isWorktreeDirty("/path/to/worktree")).toBe(false);
  });

  test("dirty worktree returns true", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("status") && args.includes("--porcelain")) {
        return { stdout: " M src/file.ts\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isWorktreeDirty } = await import("./git");
    expect(await isWorktreeDirty("/path/to/worktree")).toBe(true);
  });

  test("returns true when git status fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("status") && args.includes("--porcelain")) {
        return { stdout: "", exitCode: 128 };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isWorktreeDirty } = await import("./git");
    expect(await isWorktreeDirty("/path/to/worktree")).toBe(true);
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

  test("merged branch returns true", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("--merged")) {
        return { stdout: "  main\n  feature/completed\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isBranchMerged } = await import("./git");
    expect(await isBranchMerged("feature/completed")).toBe(true);
  });

  test("unmerged branch returns false", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("--merged")) {
        return { stdout: "  main\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isBranchMerged } = await import("./git");
    expect(await isBranchMerged("feature/in-progress")).toBe(false);
  });

  test("returns false when git branch --merged fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("--merged")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isBranchMerged } = await import("./git");
    expect(await isBranchMerged("feature/test")).toBe(false);
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

  test("branch exists on remote returns false", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "abc123\trefs/heads/main\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git");
    expect(await isRemoteBranchDeleted("main")).toBe(false);
  });

  test("branch deleted from remote returns true", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git");
    expect(await isRemoteBranchDeleted("feature/deleted")).toBe(true);
  });

  test("returns true when ls-remote fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("ls-remote")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { isRemoteBranchDeleted } = await import("./git");
    expect(await isRemoteBranchDeleted("feature/test")).toBe(true);
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

  test("retrieves worktree list", async () => {
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
      if (args.includes("list") && args.includes("--porcelain")) {
        return { stdout: porcelainOutput };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("status") && args.includes("--porcelain")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { listWorktrees } = await import("./git");
    const { worktrees } = await listWorktrees();

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].branch).toBe("main");
    expect(worktrees[0].isMain).toBe(true);
    expect(worktrees[1].branch).toBe("feature/test");
    expect(worktrees[1].isMain).toBe(false);
  });

  test("empty worktree list", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("list") && args.includes("--porcelain")) {
        return { stdout: "" };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { listWorktrees } = await import("./git");
    const { worktrees } = await listWorktrees();

    expect(worktrees).toHaveLength(0);
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
      if (args.includes("list") && args.includes("--porcelain")) {
        return { stdout: porcelainOutput };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("status") && args.includes("--porcelain")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { findWorktreeByBranch } = await import("./git");
    const worktree = await findWorktreeByBranch("feature/test");

    expect(worktree).not.toBeNull();
    expect(worktree?.branch).toBe("feature/test");
  });

  test("non-existent branch returns null", async () => {
    const porcelainOutput = ["worktree /path/to/repo", "HEAD abc123", "branch refs/heads/main"].join("\n");

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("list") && args.includes("--porcelain")) {
        return { stdout: porcelainOutput };
      }
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
      if (args.includes("status") && args.includes("--porcelain")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { findWorktreeByBranch } = await import("./git");
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
      if (args.includes("-d")) {
        return { stdout: "" };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { deleteLocalBranch } = await import("./git");
    await expect(deleteLocalBranch("feature/old")).resolves.toBeUndefined();
  });

  test("deleting non-existent branch throws error", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("-d")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { deleteLocalBranch } = await import("./git");
    await expect(deleteLocalBranch("nonexistent-branch")).rejects.toThrow("Failed to delete branch");
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
        return { stdout: "", exitCode: 0 };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { branchExists } = await import("./git");
    expect(await branchExists("main")).toBe(true);
  });

  test("returns false for non-existent branch", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (args.includes("show-ref")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec: ${args.join(" ")}`);
    });

    const { branchExists } = await import("./git");
    expect(await branchExists("nonexistent-branch")).toBe(false);
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

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isMain: true, branch: "main" });
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Main worktree");
  });

  test("locked worktree has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isLocked: true });
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Locked");
  });

  test("dirty worktree has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Has uncommitted changes");
  });

  test("condition priority: isMain > isLocked > isDirty", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");

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

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ branch: null });
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses).toHaveLength(1);
    expect(statuses[0].branchMerged).toBe(false);
    expect(statuses[0].branchDeletedOnRemote).toBe(false);
  });

  test("merged branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Merged");
  });

  test("remote deleted branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Remote deleted");
  });

  test("merged & remote deleted", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Merged & remote deleted");
  });

  test("active branch has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree], "main");

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Active");
  });
});
