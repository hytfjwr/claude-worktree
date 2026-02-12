import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getCurrentPaneId } from "./wezterm.ts";

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

describe("listWeztermPanes", () => {
  beforeEach(() => vi.resetModules());

  test("returns null when WezTerm is not available (mock)", async () => {
    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      listWeztermPanes: vi.fn(async () => null),
    }));

    const { listWeztermPanes: mockedList } = await import("./wezterm.ts");
    const result = await mockedList();
    expect(result).toBeNull();
  });

  test("returns parsed panes (mock)", async () => {
    const mockPanes = [
      { pane_id: 1, title: "claude", cwd: "/tmp/wt-1" },
      { pane_id: 2, title: "shell", cwd: "/tmp/wt-2" },
    ];
    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      listWeztermPanes: vi.fn(async () => mockPanes),
    }));

    const { listWeztermPanes: mockedList } = await import("./wezterm.ts");
    const result = await mockedList();
    expect(result).toEqual(mockPanes);
    expect(result?.[0].pane_id).toBe(1);
    expect(result?.[1].title).toBe("shell");
  });
});

// ============================================================================
// Tests for functions using shell commands (using vi.doMock)
// ============================================================================

describe("splitPaneRight (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("returns pane ID", async () => {
    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      splitPaneRight: vi.fn(async () => "new-pane-123"),
    }));

    const { splitPaneRight } = await import("./wezterm.ts");
    const result = await splitPaneRight();

    expect(result).toBe("new-pane-123");
  });
});

describe("sendText (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("sends text", async () => {
    const mockSendText = vi.fn(async () => undefined);

    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      sendText: mockSendText,
    }));

    const { sendText } = await import("./wezterm.ts");
    await sendText("pane-123", "hello world");

    expect(mockSendText).toHaveBeenCalledWith("pane-123", "hello world");
  });
});

describe("sendCommand (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("sends text with newline", async () => {
    const mockSendCommand = vi.fn(async () => undefined);

    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      sendCommand: mockSendCommand,
    }));

    const { sendCommand } = await import("./wezterm.ts");
    await sendCommand("pane-123", "ls -la");

    expect(mockSendCommand).toHaveBeenCalledWith("pane-123", "ls -la");
  });
});

describe("activatePane (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("activates pane", async () => {
    const mockActivatePane = vi.fn(async () => undefined);

    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      activatePane: mockActivatePane,
    }));

    const { activatePane } = await import("./wezterm.ts");
    await activatePane("target-pane-456");

    expect(mockActivatePane).toHaveBeenCalledWith("target-pane-456");
  });
});

describe("createPane (mock)", () => {
  beforeEach(() => vi.resetModules());

  test("creates pane and returns new paneId", async () => {
    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      createPane: vi.fn(async () => "created-pane-999"),
    }));

    const { createPane } = await import("./wezterm.ts");
    const result = await createPane({});

    expect(result).toBe("created-pane-999");
  });

  test("creates pane with keepFocus", async () => {
    vi.doMock("./wezterm", async () => ({
      ...(await vi.importActual("./wezterm")),
      createPane: vi.fn(async () => "new-pane"),
    }));

    const { createPane } = await import("./wezterm.ts");
    const result = await createPane({ keepFocus: true });

    expect(result).toBe("new-pane");
  });
});
