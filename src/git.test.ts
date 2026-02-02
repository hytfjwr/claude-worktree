import { describe, expect, test } from "bun:test";
import {
  getWorktreePath,
  buildWorktreeCommand,
  getGitContext,
  getMainBranch,
  isWorktreeDirty,
  isBranchMerged,
  isRemoteBranchDeleted,
  listWorktrees,
  findWorktreeByBranch,
  deleteLocalBranch,
  parseWorktreePorcelain,
  getWorktreeStatuses,
  branchExists,
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
// シェルコマンドを使う関数のテスト（実際のgitリポジトリを使用）
// ============================================================================

describe("getGitContext", () => {
  test("現在のリポジトリ情報を取得", async () => {
    const context = await getGitContext();

    expect(context.repoRoot).toContain("claude-worktree");
    expect(context.repoName).toContain("claude-worktree");
    expect(typeof context.currentBranch).toBe("string");
    expect(context.currentBranch.length).toBeGreaterThan(0);
  });
});

describe("getMainBranch", () => {
  test("メインブランチ名を取得", async () => {
    const mainBranch = await getMainBranch();

    // main または master のいずれか
    expect(["main", "master"]).toContain(mainBranch);
  });
});

describe("isWorktreeDirty", () => {
  test("現在のワークツリーの状態をチェック", async () => {
    const context = await getGitContext();
    const isDirty = await isWorktreeDirty(context.repoRoot);

    // boolean を返すことを確認
    expect(typeof isDirty).toBe("boolean");
  });
});

describe("isBranchMerged", () => {
  test("ブランチマージ判定がboolean値を返す", async () => {
    const mainBranch = await getMainBranch();
    const isMerged = await isBranchMerged(mainBranch);

    expect(typeof isMerged).toBe("boolean");
  });

  test("存在しないブランチはfalse", async () => {
    const isMerged = await isBranchMerged("nonexistent-branch-xyz-12345");

    expect(isMerged).toBe(false);
  });
});

describe("isRemoteBranchDeleted", () => {
  test("mainブランチはリモートに存在", async () => {
    const mainBranch = await getMainBranch();
    const isDeleted = await isRemoteBranchDeleted(mainBranch);

    expect(isDeleted).toBe(false);
  });

  test("存在しないブランチはtrue", async () => {
    const isDeleted = await isRemoteBranchDeleted("nonexistent-branch-xyz-12345");

    expect(isDeleted).toBe(true);
  });
});

describe("listWorktrees", () => {
  test("worktree一覧を取得", async () => {
    const worktrees = await listWorktrees();

    // 少なくとも1つのworktree（メイン）が存在
    expect(worktrees.length).toBeGreaterThanOrEqual(1);

    // 各worktreeの構造を確認
    for (const worktree of worktrees) {
      expect(typeof worktree.path).toBe("string");
      expect(worktree.path.length).toBeGreaterThan(0);
      expect(typeof worktree.isLocked).toBe("boolean");
      expect(typeof worktree.isDirty).toBe("boolean");
      expect(typeof worktree.isMain).toBe("boolean");
    }
  });

  test("メインworktreeが含まれる", async () => {
    const worktrees = await listWorktrees();
    const mainWorktree = worktrees.find((w) => w.isMain);

    expect(mainWorktree).toBeDefined();
  });
});

describe("findWorktreeByBranch", () => {
  test("存在するブランチを検索", async () => {
    const mainBranch = await getMainBranch();
    const worktree = await findWorktreeByBranch(mainBranch);

    expect(worktree).not.toBeNull();
    expect(worktree?.branch).toBe(mainBranch);
  });

  test("存在しないブランチはnullを返す", async () => {
    const worktree = await findWorktreeByBranch("nonexistent-branch-xyz-12345");

    expect(worktree).toBeNull();
  });
});

describe("deleteLocalBranch", () => {
  test("存在しないブランチを削除するとエラー", async () => {
    await expect(deleteLocalBranch("nonexistent-branch-xyz-12345")).rejects.toThrow(
      "Failed to delete branch"
    );
  });

  test("forceフラグが機能する", async () => {
    // force=trueでも存在しないブランチはエラー
    await expect(deleteLocalBranch("nonexistent-branch-xyz-12345", true)).rejects.toThrow(
      "Failed to delete branch"
    );
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
// getWorktreeStatuses のテスト（DIを使用）
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
    const worktree = createWorktree({ isMain: true, branch: "main" });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("メインworktree");
  });

  test("ロック中はcanAutoClean: false", async () => {
    const worktree = createWorktree({ isLocked: true });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("ロック中");
  });

  test("ダーティはcanAutoClean: false", async () => {
    const worktree = createWorktree({ isDirty: true });
    const statuses = await getWorktreeStatuses([worktree]);

    expect(statuses[0].canAutoClean).toBe(false);
    expect(statuses[0].reason).toBe("未コミットの変更あり");
  });

  test("条件優先度: isMain > isLocked > isDirty", async () => {
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
    const worktree = createWorktree({ branch: null });
    const statuses = await getWorktreeStatuses([worktree]);

    // branch: null でも処理が完了する
    expect(statuses).toHaveLength(1);
    expect(statuses[0].branchMerged).toBe(false);
    expect(statuses[0].branchDeletedOnRemote).toBe(false);
  });
});

describe("branchExists", () => {
  test("mainブランチが存在する場合trueを返す", async () => {
    const mainBranch = await getMainBranch();
    const exists = await branchExists(mainBranch);

    expect(exists).toBe(true);
  });

  test("存在しないブランチはfalseを返す", async () => {
    const exists = await branchExists("nonexistent-branch-xyz-12345");

    expect(exists).toBe(false);
  });
});
