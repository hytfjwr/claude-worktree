import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { saveEnv } from "../__test-utils__.ts";

// Only mock the async check functions that run shell commands.
// isRunningInside* functions are pure env-var reads — test via real env vars.
const { mockCheckWezterm, mockCheckTmux } = vi.hoisted(() => ({
  mockCheckWezterm: vi.fn(async () => false),
  mockCheckTmux: vi.fn(async () => false),
}));

vi.mock("./wezterm.ts", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("./wezterm.ts");
  return { ...original, checkWeztermAvailable: mockCheckWezterm };
});

vi.mock("./tmux.ts", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("./tmux.ts");
  return { ...original, checkTmuxAvailable: mockCheckTmux };
});

import {
  createTmuxBackend,
  createWeztermBackend,
  detectBackend,
  ensurePaneBackendAvailable,
} from "./terminal-backend.ts";

describe("detectBackend", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveEnv("WEZTERM_PANE", "TMUX");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns 'wezterm' when WEZTERM_PANE is set", () => {
    process.env.WEZTERM_PANE = "42";
    delete process.env.TMUX;

    expect(detectBackend()).toBe("wezterm");
  });

  test("returns 'tmux' when TMUX is set", () => {
    delete process.env.WEZTERM_PANE;
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";

    expect(detectBackend()).toBe("tmux");
  });

  test("returns 'wezterm' when both are set (wezterm takes priority)", () => {
    process.env.WEZTERM_PANE = "42";
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";

    expect(detectBackend()).toBe("wezterm");
  });

  test("returns null when neither is set", () => {
    delete process.env.WEZTERM_PANE;
    delete process.env.TMUX;

    expect(detectBackend()).toBeNull();
  });
});

describe("createWeztermBackend", () => {
  test("returns backend with name 'wezterm'", () => {
    const backend = createWeztermBackend();
    expect(backend.name).toBe("wezterm");
  });
});

describe("createTmuxBackend", () => {
  test("returns backend with name 'tmux'", () => {
    const backend = createTmuxBackend();
    expect(backend.name).toBe("tmux");
  });
});

describe("ensurePaneBackendAvailable", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv = saveEnv("WEZTERM_PANE", "TMUX", "TERM_PROGRAM");
    delete process.env.WEZTERM_PANE;
    delete process.env.TMUX;
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns wezterm backend when inside WezTerm", async () => {
    process.env.WEZTERM_PANE = "42";

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("wezterm");
  });

  test("returns tmux backend when inside tmux", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("throws when neither installed", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(false);

    const { DependencyError } = await import("../core/errors.ts");
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(DependencyError);
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("requires WezTerm or tmux");
  });

  test("returns tmux backend when tmux is installed but not inside tmux", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(true);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("returns tmux backend when both installed but not inside either", async () => {
    process.env.TERM_PROGRAM = "ghostty";
    mockCheckWezterm.mockResolvedValue(true);
    mockCheckTmux.mockResolvedValue(true);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("throws with terminal info when only WezTerm installed but not inside", async () => {
    process.env.TERM_PROGRAM = "iTerm2";
    mockCheckWezterm.mockResolvedValue(true);
    mockCheckTmux.mockResolvedValue(false);

    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("iTerm2");
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("WezTerm is installed");
  });

  test("includes usage hint in error message", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(false);

    await expect(ensurePaneBackendAvailable("claude-worktree feature/auth 'test'")).rejects.toThrow(
      "claude-worktree feature/auth 'test'",
    );
  });
});
