.PHONY: install uninstall reinstall link unlink test help dev clean check setup typecheck pull

# Default target
help:
	@echo "claude-worktree Makefile commands"
	@echo ""
	@echo "  make install    - Install dependencies + global link"
	@echo "  make uninstall  - Uninstall from global"
	@echo "  make reinstall  - Reinstall"
	@echo "  make setup      - Install dependencies only"
	@echo "  make dev        - Run in development mode (no args)"
	@echo "  make test       - Run Bun tests"
	@echo "  make typecheck  - TypeScript type check"
	@echo "  make clean      - Remove node_modules etc."
	@echo "  make check      - Check dependencies"
	@echo ""

# Pull latest changes
pull:
	@echo "📥 Pulling latest changes..."
	@git pull
	@echo "✅ Updated to latest"

# Install dependencies
setup:
	@bun install
	@echo "✅ Dependencies installed"

# Install globally
install: pull setup link
	@echo "✅ claude-worktree installed"
	@echo "📍 $$(which claude-worktree)"

# Run bun link
link:
	@bun link
	@chmod +x bin/claude-worktree.ts

# Uninstall
uninstall: unlink
	@echo "✅ claude-worktree uninstalled"

# Run bun unlink
unlink:
	@bun unlink claude-worktree 2>/dev/null || true
	@rm -f ~/.bun/bin/claude-worktree

# Reinstall
reinstall: uninstall install

# Test
test:
	@bun test

# Run in development mode
dev:
	@bun run bin/claude-worktree.ts

# TypeScript type check
typecheck:
	@bun x tsc --noEmit
	@echo "✅ Type check passed"

# Delete cache
clean:
	@rm -rf node_modules bun.lockb 2>/dev/null || true
	@echo "✅ Cache deleted"

# Check dependencies
check:
	@echo "=== Dependency check ==="
	@printf "bun:     " && (which bun >/dev/null && bun --version) || echo "❌ not found"
	@printf "git:     " && (which git >/dev/null && git --version | cut -d' ' -f3) || echo "❌ not found"
	@printf "wezterm: " && (which wezterm >/dev/null && wezterm --version | cut -d' ' -f2) || echo "❌ not found"
	@printf "claude:  " && (which claude >/dev/null && claude --version 2>/dev/null | head -1) || echo "❌ not found"
	@echo ""
	@echo "✅ Check complete"
