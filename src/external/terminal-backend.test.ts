import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { saveEnv } from "../__test-utils__.ts";

// Hoisted mocks for wezterm and tmux modules
const { mockWezterm, mockTmux } = vi.hoisted(() => ({
  mockWezterm: {
    isRunningInsideWezterm: vi.fn(() => false),
    checkWeztermAvailable: vi.fn(async () => false),
    createPane: vi.fn(async () => "123"),
    sendCommand: vi.fn(async () => {}),
  },
  mockTmux: {
    isRunningInsideTmux: vi.fn(() => false),
    checkTmuxAvailable: vi.fn(async () => false),
    createPane: vi.fn(async () => "%42"),
    sendCommand: vi.fn(async () => {}),
  },
}));

vi.mock("./wezterm.ts", () => mockWezterm);
vi.mock("./tmux.ts", () => mockTmux);

import {
  createBackend,
  createTmuxBackend,
  createWeztermBackend,
  detectBackend,
  ensurePaneBackendAvailable,
} from "./terminal-backend.ts";

describe("detectBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 'wezterm' when WEZTERM_PANE is set", () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(true);
    mockTmux.isRunningInsideTmux.mockReturnValue(false);

    expect(detectBackend()).toBe("wezterm");
  });

  test("returns 'tmux' when TMUX is set", () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(true);

    expect(detectBackend()).toBe("tmux");
  });

  test("returns 'wezterm' when both are set (wezterm takes priority)", () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(true);
    mockTmux.isRunningInsideTmux.mockReturnValue(true);

    expect(detectBackend()).toBe("wezterm");
  });

  test("returns null when neither is set", () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(false);

    expect(detectBackend()).toBeNull();
  });
});

describe("createWeztermBackend", () => {
  test("returns backend with name 'wezterm'", () => {
    const backend = createWeztermBackend();
    expect(backend.name).toBe("wezterm");
  });

  test("delegates createPane to wezterm module", async () => {
    mockWezterm.createPane.mockResolvedValue("456");
    const backend = createWeztermBackend();
    const result = await backend.createPane();
    expect(result).toBe("456");
  });

  test("delegates sendCommand to wezterm module", async () => {
    const backend = createWeztermBackend();
    await backend.sendCommand("123", "echo hello");
    expect(mockWezterm.sendCommand).toHaveBeenCalledWith("123", "echo hello");
  });
});

describe("createTmuxBackend", () => {
  test("returns backend with name 'tmux'", () => {
    const backend = createTmuxBackend();
    expect(backend.name).toBe("tmux");
  });

  test("delegates createPane to tmux module", async () => {
    mockTmux.createPane.mockResolvedValue("%99");
    const backend = createTmuxBackend();
    const result = await backend.createPane();
    expect(result).toBe("%99");
  });

  test("delegates sendCommand to tmux module", async () => {
    const backend = createTmuxBackend();
    await backend.sendCommand("%42", "ls -la");
    expect(mockTmux.sendCommand).toHaveBeenCalledWith("%42", "ls -la");
  });
});

describe("createBackend", () => {
  test("creates wezterm backend for 'wezterm' type", () => {
    const backend = createBackend("wezterm");
    expect(backend.name).toBe("wezterm");
  });

  test("creates tmux backend for 'tmux' type", () => {
    const backend = createBackend("tmux");
    expect(backend.name).toBe("tmux");
  });
});

describe("ensurePaneBackendAvailable", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv = saveEnv("TERM_PROGRAM");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns wezterm backend when inside WezTerm", async () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(true);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("wezterm");
  });

  test("returns tmux backend when inside tmux", async () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(true);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("throws when neither installed", async () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(false);
    mockWezterm.checkWeztermAvailable.mockResolvedValue(false);
    mockTmux.checkTmuxAvailable.mockResolvedValue(false);

    const { DependencyError } = await import("../core/errors.ts");
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(DependencyError);
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("requires WezTerm or tmux");
  });

  test("returns tmux backend when tmux is installed but not inside tmux", async () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(false);
    mockWezterm.checkWeztermAvailable.mockResolvedValue(false);
    mockTmux.checkTmuxAvailable.mockResolvedValue(true);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("returns tmux backend when both installed but not inside either", async () => {
    process.env.TERM_PROGRAM = "ghostty";
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(false);
    mockWezterm.checkWeztermAvailable.mockResolvedValue(true);
    mockTmux.checkTmuxAvailable.mockResolvedValue(true);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("throws with terminal info when only WezTerm installed but not inside", async () => {
    process.env.TERM_PROGRAM = "iTerm2";
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(false);
    mockWezterm.checkWeztermAvailable.mockResolvedValue(true);
    mockTmux.checkTmuxAvailable.mockResolvedValue(false);

    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("iTerm2");
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("WezTerm is installed");
  });

  test("includes usage hint in error message", async () => {
    mockWezterm.isRunningInsideWezterm.mockReturnValue(false);
    mockTmux.isRunningInsideTmux.mockReturnValue(false);
    mockWezterm.checkWeztermAvailable.mockResolvedValue(false);
    mockTmux.checkTmuxAvailable.mockResolvedValue(false);

    await expect(ensurePaneBackendAvailable("claude-worktree feature/auth 'test'")).rejects.toThrow(
      "claude-worktree feature/auth 'test'",
    );
  });
});
