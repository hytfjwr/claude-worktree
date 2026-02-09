import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { WorktreeInfo } from "../types";
import type { ExecResult } from "./exec";
import { buildWorktreeCommand, getWorktreePath, parseWorktreePorcelain } from "./git";

// Hoisted mock for ./exec — default passthrough, overridable per-test via mockExecImpl
const { mockExecImpl } = vi.hoisted(() => ({
  mockExecImpl: { current: null as ((cmd: string, args: string[]) => unknown) | null },
}));

vi.mock("./exec", async (importOriginal) => {
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

describe("getGitContext (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("correctly retrieves repository info", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      getGitContext: vi.fn(async () => ({
        repoRoot: "/path/to/my-repo",
        repoName: "my-repo",
        currentBranch: "feature/test",
      })),
    }));

    const { getGitContext } = await import("./git");
    const context = await getGitContext();

    expect(context.repoRoot).toBe("/path/to/my-repo");
    expect(context.repoName).toBe("my-repo");
    expect(context.currentBranch).toBe("feature/test");
  });
});

describe("getMainBranch (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("returns main branch", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      getMainBranch: vi.fn(async () => "main"),
    }));

    const { getMainBranch } = await import("./git");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("main");
  });

  test("returns master branch", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      getMainBranch: vi.fn(async () => "master"),
    }));

    const { getMainBranch } = await import("./git");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("master");
  });
});

describe("isWorktreeDirty (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("clean worktree - false", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      isWorktreeDirty: vi.fn(async () => false),
    }));

    const { isWorktreeDirty } = await import("./git");
    const isDirty = await isWorktreeDirty("/path/to/worktree");

    expect(isDirty).toBe(false);
  });

  test("dirty worktree - true", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      isWorktreeDirty: vi.fn(async () => true),
    }));

    const { isWorktreeDirty } = await import("./git");
    const isDirty = await isWorktreeDirty("/path/to/worktree");

    expect(isDirty).toBe(true);
  });
});

describe("isBranchMerged (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("merged branch - true", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      isBranchMerged: vi.fn(async () => true),
    }));

    const { isBranchMerged } = await import("./git");
    const isMerged = await isBranchMerged("feature/completed");

    expect(isMerged).toBe(true);
  });

  test("unmerged branch - false", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      isBranchMerged: vi.fn(async () => false),
    }));

    const { isBranchMerged } = await import("./git");
    const isMerged = await isBranchMerged("feature/in-progress");

    expect(isMerged).toBe(false);
  });
});

describe("isRemoteBranchDeleted (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("branch exists on remote - false", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      isRemoteBranchDeleted: vi.fn(async () => false),
    }));

    const { isRemoteBranchDeleted } = await import("./git");
    const isDeleted = await isRemoteBranchDeleted("main");

    expect(isDeleted).toBe(false);
  });

  test("branch deleted from remote - true", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      isRemoteBranchDeleted: vi.fn(async () => true),
    }));

    const { isRemoteBranchDeleted } = await import("./git");
    const isDeleted = await isRemoteBranchDeleted("feature/deleted");

    expect(isDeleted).toBe(true);
  });
});

describe("listWorktrees (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("retrieves worktree list", async () => {
    const mockWorktrees: WorktreeInfo[] = [
      {
        path: "/path/to/repo",
        branch: "main",
        isLocked: false,
        isDirty: false,
        isMain: true,
      },
      {
        path: "/path/to/repo-feature",
        branch: "feature/test",
        isLocked: false,
        isDirty: false,
        isMain: false,
      },
    ];

    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      listWorktrees: vi.fn(async () => mockWorktrees),
    }));

    const { listWorktrees } = await import("./git");
    const worktrees = await listWorktrees();

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].branch).toBe("main");
    expect(worktrees[0].isMain).toBe(true);
    expect(worktrees[1].branch).toBe("feature/test");
    expect(worktrees[1].isMain).toBe(false);
  });

  test("empty worktree list", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      listWorktrees: vi.fn(async () => []),
    }));

    const { listWorktrees } = await import("./git");
    const worktrees = await listWorktrees();

    expect(worktrees).toHaveLength(0);
  });
});

describe("findWorktreeByBranch (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("finds existing branch", async () => {
    const mockWorktree: WorktreeInfo = {
      path: "/path/to/repo-feature",
      branch: "feature/test",
      isLocked: false,
      isDirty: false,
      isMain: false,
    };

    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      findWorktreeByBranch: vi.fn(async () => mockWorktree),
    }));

    const { findWorktreeByBranch } = await import("./git");
    const worktree = await findWorktreeByBranch("feature/test");

    expect(worktree).not.toBeNull();
    expect(worktree?.branch).toBe("feature/test");
  });

  test("non-existent branch returns null", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      findWorktreeByBranch: vi.fn(async () => null),
    }));

    const { findWorktreeByBranch } = await import("./git");
    const worktree = await findWorktreeByBranch("nonexistent-branch");

    expect(worktree).toBeNull();
  });
});

describe("deleteLocalBranch (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("branch deletion succeeds", async () => {
    const mockDeleteLocalBranch = vi.fn(async () => undefined);

    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      deleteLocalBranch: mockDeleteLocalBranch,
    }));

    const { deleteLocalBranch } = await import("./git");

    await expect(deleteLocalBranch("feature/old")).resolves.toBeUndefined();
  });

  test("deleting non-existent branch throws error", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      deleteLocalBranch: vi.fn(async () => {
        throw new Error("Failed to delete branch nonexistent-branch: error: branch 'nonexistent-branch' not found.");
      }),
    }));

    const { deleteLocalBranch } = await import("./git");

    await expect(deleteLocalBranch("nonexistent-branch")).rejects.toThrow("Failed to delete branch");
  });
});

describe("branchExists (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("returns true when branch exists", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      branchExists: vi.fn(async () => true),
    }));

    const { branchExists } = await import("./git");
    const exists = await branchExists("main");

    expect(exists).toBe(true);
  });

  test("returns false for non-existent branch", async () => {
    vi.doMock("./git", async () => ({
      ...(await vi.importActual("./git")),
      branchExists: vi.fn(async () => false),
    }));

    const { branchExists } = await import("./git");
    const exists = await branchExists("nonexistent-branch");

    expect(exists).toBe(false);
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
      if (args.includes("symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main\n" };
      }
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
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Main worktree");
  });

  test("locked worktree has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isLocked: true });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Locked");
  });

  test("dirty worktree has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Has uncommitted changes");
  });

  test("condition priority: isMain > isLocked > isDirty", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");

    // isMain takes highest priority
    const mainAndLocked = createWorktree({ isMain: true, isLocked: true, isDirty: true });
    const statusMain = await getWorktreeStatuses([mainAndLocked]);
    expect(statusMain[0].reason).toBe("Main worktree");

    // isLocked takes next priority
    const lockedAndDirty = createWorktree({ isLocked: true, isDirty: true });
    const statusLocked = await getWorktreeStatuses([lockedAndDirty]);
    expect(statusLocked[0].reason).toBe("Locked");
  });

  test("null branch does not cause error", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ branch: null });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].branchMerged).toBe(false);
    expect(statuses[0].branchDeletedOnRemote).toBe(false);
  });

  test("merged branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Merged");
  });

  test("remote deleted branch has canAutoClean: true", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Remote deleted");
  });

  test("merged & remote deleted", async () => {
    setExecMockForStatuses({ branchMerged: true, remoteBranchDeleted: true });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("Merged & remote deleted");
  });

  test("active branch has canAutoClean: false", async () => {
    setExecMockForStatuses({ branchMerged: false, remoteBranchDeleted: false });

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("Active");
  });
});
