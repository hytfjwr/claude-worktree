.PHONY: install uninstall reinstall link unlink test help dev clean check setup typecheck pull

# デフォルトターゲット
help:
	@echo "claude-worktree Makefile コマンド一覧"
	@echo ""
	@echo "  make install    - 依存関係インストール + グローバルリンク"
	@echo "  make uninstall  - グローバルからアンインストール"
	@echo "  make reinstall  - 再インストール"
	@echo "  make setup      - 依存関係のみインストール"
	@echo "  make dev        - 開発モードで実行 (引数なし)"
	@echo "  make test       - ヘルプメッセージを表示してテスト"
	@echo "  make typecheck  - TypeScript型チェック"
	@echo "  make clean      - node_modules等を削除"
	@echo "  make check      - 依存関係の確認"
	@echo ""

# 最新の変更を取得
pull:
	@echo "📥 最新の変更を取得中..."
	@git pull
	@echo "✅ 最新の状態に更新しました"

# 依存関係インストール
setup:
	@bun install
	@echo "✅ 依存関係をインストールしました"

# グローバルにインストール
install: pull setup link
	@echo "✅ claude-worktree をインストールしました"
	@echo "📍 $$(which claude-worktree)"

# bun linkを実行
link:
	@bun link
	@chmod +x bin/claude-worktree.ts

# アンインストール
uninstall: unlink
	@echo "✅ claude-worktree をアンインストールしました"

# bun unlinkを実行
unlink:
	@bun unlink claude-worktree 2>/dev/null || true
	@rm -f ~/.bun/bin/claude-worktree

# 再インストール
reinstall: uninstall install

# テスト（ヘルプ表示）
test:
	@echo "=== ヘルプメッセージのテスト ==="
	@claude-worktree 2>&1 || true
	@echo ""
	@echo "=== インストール確認 ==="
	@which claude-worktree
	@echo ""
	@echo "✅ テスト完了"

# 開発モードで実行
dev:
	@bun run bin/claude-worktree.ts

# TypeScript型チェック
typecheck:
	@bun x tsc --noEmit
	@echo "✅ 型チェック完了"

# キャッシュ削除
clean:
	@rm -rf node_modules bun.lockb 2>/dev/null || true
	@echo "✅ キャッシュを削除しました"

# 依存関係の確認
check:
	@echo "=== 依存関係の確認 ==="
	@printf "bun:     " && (which bun >/dev/null && bun --version) || echo "❌ not found"
	@printf "git:     " && (which git >/dev/null && git --version | cut -d' ' -f3) || echo "❌ not found"
	@printf "wezterm: " && (which wezterm >/dev/null && wezterm --version | cut -d' ' -f2) || echo "❌ not found"
	@printf "claude:  " && (which claude >/dev/null && claude --version 2>/dev/null | head -1) || echo "❌ not found"
	@echo ""
	@echo "✅ 確認完了"
