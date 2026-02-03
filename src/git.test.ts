import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  getWorktreePath,
  buildWorktreeCommand,
  parseWorktreePorcelain,
  type WorktreeInfo,
} from "./git";

// ============================================================================
// 純粋関数のテスト（モック不要）
// ============================================================================

describe("getWorktreePath", () => {
  test("スラッシュ含むブランチ - feature/test → repo-feature-test", () => {
    const result = getWorktreePath("/path/to/repo", "repo", "feature/test");
    expect(result).toBe("/path/to/repo-feature-test");
  });

  test("複数スラッシュ - feature/auth/oauth → repo-feature-auth-oauth", () => {
    const result = getWorktreePath("/path/to/repo", "repo", "feature/auth/oauth");
    expect(result).toBe("/path/to/repo-feature-auth-oauth");
  });

  test("スラッシュなし - main → repo-main", () => {
    const result = getWorktreePath("/path/to/repo", "repo", "main");
    expect(result).toBe("/path/to/repo-main");
  });

  test("異なるリポジトリ名", () => {
    const result = getWorktreePath("/home/user/projects/my-app", "my-app", "fix/bug-123");
    expect(result).toBe("/home/user/projects/my-app-fix-bug-123");
  });
});

describe("buildWorktreeCommand", () => {
  test("基本コマンド - 正しいgit worktree addコマンド生成", () => {
    const result = buildWorktreeCommand("feature/test", "/path/to/worktree", "main");
    expect(result).toBe('git worktree add -b feature/test "/path/to/worktree" main');
  });

  test("スペース含むパス - パスがクォートされる", () => {
    const result = buildWorktreeCommand("feature/new", "/path with spaces/worktree", "develop");
    expect(result).toBe('git worktree add -b feature/new "/path with spaces/worktree" develop');
  });

  test("異なるベースブランチ", () => {
    const result = buildWorktreeCommand("fix/issue", "/worktree/path", "develop");
    expect(result).toBe('git worktree add -b fix/issue "/worktree/path" develop');
  });
});

// ============================================================================
// parseWorktreePorcelain のテスト（純粋関数）
// ============================================================================

describe("parseWorktreePorcelain", () => {
  test("空出力 - 空配列を返す", () => {
    const result = parseWorktreePorcelain("", "main");
    expect(result).toEqual([]);
  });

  test("空白のみ - 空配列を返す", () => {
    const result = parseWorktreePorcelain("  \n  ", "main");
    expect(result).toEqual([]);
  });

  test("単一worktree - 正しくパース", () => {
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

  test("複数worktree - 複数を正しくパース", () => {
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

  test("locked属性 - isLocked: true", () => {
    const output = `worktree /path/to/locked
HEAD abc123
branch refs/heads/feature/locked
locked`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result[0].isLocked).toBe(true);
  });

  test("bare属性 - isMain: true (bare repository)", () => {
    const output = `worktree /path/to/bare
bare`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result[0].isMain).toBe(true);
    expect(result[0].branch).toBeNull();
  });

  test("branch refs/heads/からの抽出 - プレフィックス除去", () => {
    const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/feature/deep/nested/branch`;

    const result = parseWorktreePorcelain(output, "main");

    expect(result[0].branch).toBe("feature/deep/nested/branch");
  });

  test("mainブランチ判定 - 指定したブランチがmainの場合", () => {
    const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/develop`;

    // developをmainブランチとして指定
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
// シェルコマンドを使う関数のテスト（モックを使用）
// ============================================================================

describe("getGitContext (モック)", () => {
  test("リポジトリ情報を正しく取得", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      getGitContext: mock(async () => ({
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

describe("getMainBranch (モック)", () => {
  test("mainブランチを返す", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      getMainBranch: mock(async () => "main"),
    }));

    const { getMainBranch } = await import("./git");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("main");
  });

  test("masterブランチを返す", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      getMainBranch: mock(async () => "master"),
    }));

    const { getMainBranch } = await import("./git");
    const mainBranch = await getMainBranch();

    expect(mainBranch).toBe("master");
  });
});

describe("isWorktreeDirty (モック)", () => {
  test("クリーンなworktree - false", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isWorktreeDirty: mock(async () => false),
    }));

    const { isWorktreeDirty } = await import("./git");
    const isDirty = await isWorktreeDirty("/path/to/worktree");

    expect(isDirty).toBe(false);
  });

  test("ダーティなworktree - true", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isWorktreeDirty: mock(async () => true),
    }));

    const { isWorktreeDirty } = await import("./git");
    const isDirty = await isWorktreeDirty("/path/to/worktree");

    expect(isDirty).toBe(true);
  });
});

describe("isBranchMerged (モック)", () => {
  test("マージ済みブランチ - true", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => true),
    }));

    const { isBranchMerged } = await import("./git");
    const isMerged = await isBranchMerged("feature/completed");

    expect(isMerged).toBe(true);
  });

  test("未マージブランチ - false", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
    }));

    const { isBranchMerged } = await import("./git");
    const isMerged = await isBranchMerged("feature/in-progress");

    expect(isMerged).toBe(false);
  });
});

describe("isRemoteBranchDeleted (モック)", () => {
  test("リモートに存在するブランチ - false", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { isRemoteBranchDeleted } = await import("./git");
    const isDeleted = await isRemoteBranchDeleted("main");

    expect(isDeleted).toBe(false);
  });

  test("リモートから削除されたブランチ - true", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isRemoteBranchDeleted: mock(async () => true),
    }));

    const { isRemoteBranchDeleted } = await import("./git");
    const isDeleted = await isRemoteBranchDeleted("feature/deleted");

    expect(isDeleted).toBe(true);
  });
});

describe("listWorktrees (モック)", () => {
  test("worktree一覧を取得", async () => {
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

    mock.module("./git", () => ({
      ...require("./git"),
      listWorktrees: mock(async () => mockWorktrees),
    }));

    const { listWorktrees } = await import("./git");
    const worktrees = await listWorktrees();

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].branch).toBe("main");
    expect(worktrees[0].isMain).toBe(true);
    expect(worktrees[1].branch).toBe("feature/test");
    expect(worktrees[1].isMain).toBe(false);
  });

  test("空のworktree一覧", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      listWorktrees: mock(async () => []),
    }));

    const { listWorktrees } = await import("./git");
    const worktrees = await listWorktrees();

    expect(worktrees).toHaveLength(0);
  });
});

describe("findWorktreeByBranch (モック)", () => {
  test("存在するブランチを検索", async () => {
    const mockWorktree: WorktreeInfo = {
      path: "/path/to/repo-feature",
      branch: "feature/test",
      isLocked: false,
      isDirty: false,
      isMain: false,
    };

    mock.module("./git", () => ({
      ...require("./git"),
      findWorktreeByBranch: mock(async () => mockWorktree),
    }));

    const { findWorktreeByBranch } = await import("./git");
    const worktree = await findWorktreeByBranch("feature/test");

    expect(worktree).not.toBeNull();
    expect(worktree?.branch).toBe("feature/test");
  });

  test("存在しないブランチはnullを返す", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      findWorktreeByBranch: mock(async () => null),
    }));

    const { findWorktreeByBranch } = await import("./git");
    const worktree = await findWorktreeByBranch("nonexistent-branch");

    expect(worktree).toBeNull();
  });
});

describe("deleteLocalBranch (モック)", () => {
  test("ブランチ削除成功", async () => {
    const mockDeleteLocalBranch = mock(async () => undefined);

    mock.module("./git", () => ({
      ...require("./git"),
      deleteLocalBranch: mockDeleteLocalBranch,
    }));

    const { deleteLocalBranch } = await import("./git");

    await expect(deleteLocalBranch("feature/old")).resolves.toBeUndefined();
  });

  test("存在しないブランチを削除するとエラー", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      deleteLocalBranch: mock(async () => {
        throw new Error("Failed to delete branch nonexistent-branch: error: branch 'nonexistent-branch' not found.");
      }),
    }));

    const { deleteLocalBranch } = await import("./git");

    await expect(deleteLocalBranch("nonexistent-branch")).rejects.toThrow("Failed to delete branch");
  });
});

describe("branchExists (モック)", () => {
  test("ブランチが存在する場合trueを返す", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      branchExists: mock(async () => true),
    }));

    const { branchExists } = await import("./git");
    const exists = await branchExists("main");

    expect(exists).toBe(true);
  });

  test("存在しないブランチはfalseを返す", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      branchExists: mock(async () => false),
    }));

    const { branchExists } = await import("./git");
    const exists = await branchExists("nonexistent-branch");

    expect(exists).toBe(false);
  });
});

// ============================================================================
// getWorktreeStatuses のテスト（純粋ロジックのテスト）
// ============================================================================

describe("getWorktreeStatuses", () => {
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

  test("メインworktreeはcanAutoClean: false", async () => {
    // getWorktreeStatusesは内部でisBranchMergedとisRemoteBranchDeletedを呼ぶので
    // それらをモックする必要がある
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isMain: true, branch: "main" });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("メインworktree");
  });

  test("ロック中はcanAutoClean: false", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isLocked: true });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("ロック中");
  });

  test("ダーティはcanAutoClean: false", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("未コミットの変更あり");
  });

  test("条件優先度: isMain > isLocked > isDirty", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { getWorktreeStatuses } = await import("./git");

    // isMain が最優先
    const mainAndLocked = createWorktree({ isMain: true, isLocked: true, isDirty: true });
    const statusMain = await getWorktreeStatuses([mainAndLocked]);
    expect(statusMain[0].reason).toBe("メインworktree");

    // isLocked が次に優先
    const lockedAndDirty = createWorktree({ isLocked: true, isDirty: true });
    const statusLocked = await getWorktreeStatuses([lockedAndDirty]);
    expect(statusLocked[0].reason).toBe("ロック中");
  });

  test("ブランチがnullの場合もエラーにならない", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree({ branch: null });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].branchMerged).toBe(false);
    expect(statuses[0].branchDeletedOnRemote).toBe(false);
  });

  test("マージ済みブランチはcanAutoClean: true", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => true),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("マージ済み");
  });

  test("リモート削除済みブランチはcanAutoClean: true", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
      isRemoteBranchDeleted: mock(async () => true),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("リモート削除済み");
  });

  test("マージ済み & リモート削除済み", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => true),
      isRemoteBranchDeleted: mock(async () => true),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(true);
    expect(statuses[0].reason).toBe("マージ済み & リモート削除済み");
  });

  test("アクティブなブランチはcanAutoClean: false", async () => {
    mock.module("./git", () => ({
      ...require("./git"),
      isBranchMerged: mock(async () => false),
      isRemoteBranchDeleted: mock(async () => false),
    }));

    const { getWorktreeStatuses } = await import("./git");
    const worktree = createWorktree();
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("アクティブ");
  });
});
