import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { saveEnv } from "../__test-utils__.ts";

// Only mock the async check functions that run shell commands, plus the pane
// lifecycle functions so adapter tests never shell out for real.
const { mockCheckWezterm, mockCheckTmux, mockCheckHerdr, mockIsHerdrServerRunning } = vi.hoisted(() => ({
  mockCheckWezterm: vi.fn(async () => false),
  mockCheckTmux: vi.fn(async () => false),
  mockCheckHerdr: vi.fn(async () => false),
  mockIsHerdrServerRunning: vi.fn(async () => false),
}));

vi.mock("./wezterm.ts", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("./wezterm.ts");
  return {
    ...original,
    checkWeztermAvailable: mockCheckWezterm,
    createPane: vi.fn(async () => "42"),
    closePane: vi.fn(async () => {}),
    sendCommand: vi.fn(async () => {}),
  };
});

vi.mock("./tmux.ts", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("./tmux.ts");
  return {
    ...original,
    checkTmuxAvailable: mockCheckTmux,
    createPane: vi.fn(async () => "%42"),
    closePane: vi.fn(async () => {}),
    sendCommand: vi.fn(async () => {}),
  };
});

vi.mock("./herdr.ts", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("./herdr.ts");
  return {
    ...original,
    checkHerdrAvailable: mockCheckHerdr,
    isHerdrServerRunning: mockIsHerdrServerRunning,
    createPane: vi.fn(async () => ({ paneId: "w1:p1", workspaceId: "w1" })),
    closeCreatedPane: vi.fn(async () => {}),
    sendCommand: vi.fn(async () => {}),
  };
});

import * as herdr from "./herdr.ts";
import {
  BACKEND_ENV_VAR,
  createBackend,
  createHerdrBackend,
  createTmuxBackend,
  createWeztermBackend,
  detectBackend,
  ensurePaneBackendAvailable,
} from "./terminal-backend.ts";
import * as tmux from "./tmux.ts";
import * as wezterm from "./wezterm.ts";

describe("detectBackend", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveEnv("HERDR_ENV", "WEZTERM_PANE", "TMUX");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns 'wezterm' when WEZTERM_PANE is set", () => {
    delete process.env.HERDR_ENV;
    process.env.WEZTERM_PANE = "42";
    delete process.env.TMUX;

    expect(detectBackend()).toBe("wezterm");
  });

  test("returns 'tmux' when TMUX is set", () => {
    delete process.env.HERDR_ENV;
    delete process.env.WEZTERM_PANE;
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";

    expect(detectBackend()).toBe("tmux");
  });

  test("returns 'wezterm' when both are set (wezterm takes priority)", () => {
    delete process.env.HERDR_ENV;
    process.env.WEZTERM_PANE = "42";
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";

    expect(detectBackend()).toBe("wezterm");
  });

  test("returns null when neither is set", () => {
    delete process.env.HERDR_ENV;
    delete process.env.WEZTERM_PANE;
    delete process.env.TMUX;

    expect(detectBackend()).toBeNull();
  });

  test("returns 'herdr' when HERDR_ENV=1, even if WEZTERM_PANE and TMUX are also set", () => {
    process.env.HERDR_ENV = "1";
    process.env.WEZTERM_PANE = "1";
    process.env.TMUX = "x";

    expect(detectBackend()).toBe("herdr");
  });

  test("does not treat HERDR_ENV=0 as herdr", () => {
    process.env.HERDR_ENV = "0";
    process.env.WEZTERM_PANE = "1";
    delete process.env.TMUX;

    expect(detectBackend()).toBe("wezterm");
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

describe("createHerdrBackend", () => {
  test("returns backend with name 'herdr'", () => {
    const backend = createHerdrBackend();
    expect(backend.name).toBe("herdr");
  });
});

describe("createBackend", () => {
  test("returns backend with name 'herdr' for type 'herdr'", () => {
    expect(createBackend("herdr").name).toBe("herdr");
  });
});

describe("backend adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("wezterm adapter wraps createPane result and forwards closePane", async () => {
    const backend = createWeztermBackend();

    const created = await backend.createPane({ keepFocus: true });
    expect(wezterm.createPane).toHaveBeenCalledWith({ keepFocus: true });
    expect(created).toEqual({ paneId: "42" });

    await backend.closePane({ paneId: "42" });
    expect(wezterm.closePane).toHaveBeenCalledWith("42");
  });

  test("tmux adapter wraps createPane result and forwards closePane", async () => {
    const backend = createTmuxBackend();

    const created = await backend.createPane({ keepFocus: true });
    expect(tmux.createPane).toHaveBeenCalledWith({ keepFocus: true });
    expect(created).toEqual({ paneId: "%42" });

    await backend.closePane({ paneId: "%42" });
    expect(tmux.closePane).toHaveBeenCalledWith("%42");
  });

  test("herdr adapter returns createPane result as-is and forwards closePane", async () => {
    const backend = createHerdrBackend();

    const created = await backend.createPane({ keepFocus: true, cwd: "/wt" });
    expect(herdr.createPane).toHaveBeenCalledWith({ keepFocus: true, cwd: "/wt" });
    expect(created).toEqual({ paneId: "w1:p1", workspaceId: "w1" });

    await backend.closePane(created);
    expect(herdr.closeCreatedPane).toHaveBeenCalledWith(created);
  });
});

describe("ensurePaneBackendAvailable", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv = saveEnv("HERDR_ENV", "WEZTERM_PANE", "TMUX", "TERM_PROGRAM", BACKEND_ENV_VAR);
    delete process.env.HERDR_ENV;
    delete process.env.WEZTERM_PANE;
    delete process.env.TMUX;
    delete process.env[BACKEND_ENV_VAR];
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

  test("returns herdr backend when HERDR_ENV=1, without checking herdr availability", async () => {
    process.env.HERDR_ENV = "1";

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("herdr");
    expect(mockCheckHerdr).not.toHaveBeenCalled();
  });

  test("throws when neither installed", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(false);
    mockCheckHerdr.mockResolvedValue(false);

    const { DependencyError } = await import("../core/errors.ts");
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(DependencyError);
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(
      "requires WezTerm, tmux or herdr",
    );
    if (process.platform === "darwin") {
      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("brew install herdr");
    }
  });

  test("returns tmux backend when tmux is installed but not inside tmux", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(true);
    mockCheckHerdr.mockResolvedValue(false);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("returns tmux backend when both wezterm and tmux installed but not inside either", async () => {
    process.env.TERM_PROGRAM = "ghostty";
    mockCheckWezterm.mockResolvedValue(true);
    mockCheckTmux.mockResolvedValue(true);
    mockCheckHerdr.mockResolvedValue(false);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("throws with terminal info when only WezTerm installed but not inside", async () => {
    process.env.TERM_PROGRAM = "iTerm2";
    mockCheckWezterm.mockResolvedValue(true);
    mockCheckTmux.mockResolvedValue(false);
    mockCheckHerdr.mockResolvedValue(false);

    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("iTerm2");
    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("WezTerm is installed");
  });

  test("includes usage hint in error message", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(false);
    mockCheckHerdr.mockResolvedValue(false);

    await expect(ensurePaneBackendAvailable("claude-worktree feature/auth 'test'")).rejects.toThrow(
      "claude-worktree feature/auth 'test'",
    );
  });

  test("not detected: returns herdr when herdr installed, server running and tmux installed", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(true);
    mockCheckHerdr.mockResolvedValue(true);
    mockIsHerdrServerRunning.mockResolvedValue(true);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("herdr");
  });

  test("not detected: returns tmux when herdr installed but server not running and tmux installed", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(true);
    mockCheckHerdr.mockResolvedValue(true);
    mockIsHerdrServerRunning.mockResolvedValue(false);

    const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
    expect(backend.name).toBe("tmux");
  });

  test("not detected: throws mentioning no server running when herdr installed but stopped, no tmux, no wezterm", async () => {
    mockCheckWezterm.mockResolvedValue(false);
    mockCheckTmux.mockResolvedValue(false);
    mockCheckHerdr.mockResolvedValue(true);
    mockIsHerdrServerRunning.mockResolvedValue(false);

    await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("no server is running");
  });

  describe(`${BACKEND_ENV_VAR} forcing`, () => {
    test("=herdr with CLI available and server running returns herdr, even with WEZTERM_PANE set", async () => {
      process.env[BACKEND_ENV_VAR] = "herdr";
      process.env.WEZTERM_PANE = "42";
      mockCheckHerdr.mockResolvedValue(true);
      mockIsHerdrServerRunning.mockResolvedValue(true);

      const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
      expect(backend.name).toBe("herdr");
    });

    test("=herdr with CLI unavailable throws DependencyError mentioning the herdr CLI", async () => {
      process.env[BACKEND_ENV_VAR] = "herdr";
      mockCheckHerdr.mockResolvedValue(false);

      const { DependencyError } = await import("../core/errors.ts");
      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(DependencyError);
      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("herdr CLI");
    });

    test("=herdr with CLI available but server stopped throws DependencyError mentioning the herdr server", async () => {
      process.env[BACKEND_ENV_VAR] = "herdr";
      mockCheckHerdr.mockResolvedValue(true);
      mockIsHerdrServerRunning.mockResolvedValue(false);

      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow("running herdr server");
    });

    test("=tmux with tmux installed returns tmux", async () => {
      process.env[BACKEND_ENV_VAR] = "tmux";
      mockCheckTmux.mockResolvedValue(true);

      const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
      expect(backend.name).toBe("tmux");
    });

    test("=tmux with tmux not installed throws DependencyError", async () => {
      process.env[BACKEND_ENV_VAR] = "tmux";
      mockCheckTmux.mockResolvedValue(false);

      const { DependencyError } = await import("../core/errors.ts");
      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(DependencyError);
    });

    test("=wezterm with WEZTERM_PANE set returns wezterm", async () => {
      process.env[BACKEND_ENV_VAR] = "wezterm";
      process.env.WEZTERM_PANE = "42";

      const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
      expect(backend.name).toBe("wezterm");
    });

    test("=wezterm without WEZTERM_PANE throws DependencyError", async () => {
      process.env[BACKEND_ENV_VAR] = "wezterm";

      const { DependencyError } = await import("../core/errors.ts");
      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(DependencyError);
    });

    test("=foo throws UsageError mentioning the invalid value", async () => {
      process.env[BACKEND_ENV_VAR] = "foo";

      const { UsageError } = await import("../core/errors.ts");
      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(UsageError);
      await expect(ensurePaneBackendAvailable("claude-worktree test '...'")).rejects.toThrow(
        `Invalid ${BACKEND_ENV_VAR}`,
      );
    });

    test("empty string is ignored and falls through to normal detection", async () => {
      process.env[BACKEND_ENV_VAR] = "";
      process.env.WEZTERM_PANE = "42";

      const backend = await ensurePaneBackendAvailable("claude-worktree test '...'");
      expect(backend.name).toBe("wezterm");
    });
  });
});
