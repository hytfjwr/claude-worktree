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
  branchExists,
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
