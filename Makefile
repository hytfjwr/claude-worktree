.PHONY: install uninstall reinstall link unlink test help dev clean check setup typecheck pull build

# Default target
help:
	@echo "claude-worktree Makefile commands"
	@echo ""
	@echo "  make install    - Install dependencies + build + global link"
	@echo "  make uninstall  - Uninstall from global"
	@echo "  make reinstall  - Reinstall"
	@echo "  make setup      - Install dependencies only"
	@echo "  make build      - Build TypeScript to dist/"
	@echo "  make dev        - Run in development mode (no args)"
	@echo "  make test       - Run tests"
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
	@pnpm install
	@echo "✅ Dependencies installed"

# Build TypeScript
build:
	@pnpm run build
	@echo "✅ Build complete"

# Install globally
install: pull setup build link
	@echo "✅ claude-worktree installed"
	@echo "📍 $$(which claude-worktree)"

# Run pnpm link
link:
	@pnpm link --global

# Uninstall
uninstall: unlink
	@echo "✅ claude-worktree uninstalled"

# Run pnpm unlink
unlink:
	@pnpm unlink --global 2>/dev/null || true

# Reinstall
reinstall: uninstall install

# Test
test:
	@pnpm exec vitest run

# Run in development mode
dev:
	@npx tsx bin/claude-worktree.ts

# TypeScript type check
typecheck:
	@pnpm exec tsc --noEmit
	@echo "✅ Type check passed"

# Delete cache
clean:
	@rm -rf node_modules dist 2>/dev/null || true
	@echo "✅ Cache deleted"

# Check dependencies
check:
	@echo "=== Dependency check ==="
	@printf "node:    " && (which node >/dev/null && node --version) || echo "❌ not found"
	@printf "git:     " && (which git >/dev/null && git --version | cut -d' ' -f3) || echo "❌ not found"
	@printf "claude:  " && (which claude >/dev/null && claude --version 2>/dev/null | head -1) || echo "❌ not found"
	@echo ""
	@echo "--- Optional (required for --pane) ---"
	@printf "wezterm: " && (which wezterm >/dev/null && wezterm --version | cut -d' ' -f2) || echo "not found"
	@echo ""
	@echo "✅ Check complete"
