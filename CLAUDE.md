# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WezTerm + git worktree + Claude Codeを組み合わせた並列開発用CLIツール。新しいWezTermペインでgit worktreeを作成し、Claude Codeを自動起動する。

## Commands

```bash
# インストール
make install

# 開発モードで実行
make dev

# 型チェック
make typecheck   # または bun run typecheck

# リント（Biome）
bun run lint

# 依存関係の確認（bun, git, wezterm, claude）
make check
```

## Usage

```bash
claude-worktree <branch-name> <task-name> [prompt]
# Example: claude-worktree feature/auth 'Auth実装' '認証機能を実装して'
```

## Architecture

Bunランタイムで動作するTypeScript CLIツール。外部npmパッケージ依存なし（Bun組み込みAPIのみ使用）。

```
bin/
  claude-worktree.ts   # エントリポイント
src/
  cli.ts               # 引数パース・オーケストレーション
  git.ts               # Git操作（リポジトリ情報取得、worktreeパス生成）
  wezterm.ts           # WezTermペイン操作（分割、テキスト送信）
  claude.ts            # Claude Codeコマンド生成
  index.ts             # 公開API（バレルエクスポート）
```

**処理フロー:**
1. 引数パース（ブランチ名、タスク名、プロンプト）
2. gitリポジトリのルートとカレントブランチを取得
3. WezTermで右側に新しいペインを分割
4. 新しいペインでworktree作成 → 依存関係インストール → Claude Code起動

**外部ツール依存:** bun, git, wezterm CLI, claude CLI
