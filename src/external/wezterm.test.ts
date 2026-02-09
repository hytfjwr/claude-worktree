import { afterEach, describe, expect, mock, test } from "bun:test";

import { checkWeztermAvailable, getCurrentPaneId } from "./wezterm";

// ============================================================================
// Tests for pure functions using environment variables (no mocks needed)
// ============================================================================

describe("getCurrentPaneId", () => {
  const originalEnv = process.env.WEZTERM_PANE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WEZTERM_PANE;
    } else {
      process.env.WEZTERM_PANE = originalEnv;
    }
  });

  test("retrieves from environment variable", () => {
    process.env.WEZTERM_PANE = "123";
    const result = getCurrentPaneId();
    expect(result).toBe("123");
  });

  test("returns undefined when not set", () => {
    delete process.env.WEZTERM_PANE;
    const result = getCurrentPaneId();
    expect(result).toBeUndefined();
  });
});

describe("checkWeztermAvailable", () => {
  test("returns a boolean", async () => {
    const result = await checkWeztermAvailable();
    expect(typeof result).toBe("boolean");
  });
});

// ============================================================================
// Tests for functions using shell commands (using mock.module)
// ============================================================================

describe("splitPaneRight (mock)", () => {
  test("returns pane ID", async () => {
    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      splitPaneRight: mock(async () => "new-pane-123"),
    }));

    const { splitPaneRight } = await import("./wezterm");
    const result = await splitPaneRight();

    expect(result).toBe("new-pane-123");
  });
});

describe("sendText (mock)", () => {
  test("sends text", async () => {
    const mockSendText = mock(async () => undefined);

    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      sendText: mockSendText,
    }));

    const { sendText } = await import("./wezterm");
    await sendText("pane-123", "hello world");

    expect(mockSendText).toHaveBeenCalledWith("pane-123", "hello world");
  });
});

describe("sendCommand (mock)", () => {
  test("sends text with newline", async () => {
    const mockSendCommand = mock(async () => undefined);

    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      sendCommand: mockSendCommand,
    }));

    const { sendCommand } = await import("./wezterm");
    await sendCommand("pane-123", "ls -la");

    expect(mockSendCommand).toHaveBeenCalledWith("pane-123", "ls -la");
  });
});

describe("activatePane (mock)", () => {
  test("activates pane", async () => {
    const mockActivatePane = mock(async () => undefined);

    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      activatePane: mockActivatePane,
    }));

    const { activatePane } = await import("./wezterm");
    await activatePane("target-pane-456");

    expect(mockActivatePane).toHaveBeenCalledWith("target-pane-456");
  });
});

describe("createPane (mock)", () => {
  test("creates pane and returns new paneId", async () => {
    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      createPane: mock(async () => "created-pane-999"),
    }));

    const { createPane } = await import("./wezterm");
    const result = await createPane({});

    expect(result).toBe("created-pane-999");
  });

  test("creates pane with keepFocus", async () => {
    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      createPane: mock(async () => "new-pane"),
    }));

    const { createPane } = await import("./wezterm");
    const result = await createPane({ keepFocus: true });

    expect(result).toBe("new-pane");
  });
});
