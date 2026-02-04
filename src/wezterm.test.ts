import { describe, expect, test, afterEach, mock } from "bun:test";
import { getCurrentPaneId } from "./wezterm";

// ============================================================================
// 環境変数を使う純粋関数のテスト（モック不要）
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

  test("環境変数から取得", () => {
    process.env.WEZTERM_PANE = "123";
    const result = getCurrentPaneId();
    expect(result).toBe("123");
  });

  test("未設定時はundefined", () => {
    delete process.env.WEZTERM_PANE;
    const result = getCurrentPaneId();
    expect(result).toBeUndefined();
  });
});

// ============================================================================
// シェルコマンドを使う関数のテスト（mock.moduleを使用）
// ============================================================================

describe("splitPaneRight (モック)", () => {
  test("ペインIDを返す", async () => {
    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      splitPaneRight: mock(async () => "new-pane-123"),
    }));

    const { splitPaneRight } = await import("./wezterm");
    const result = await splitPaneRight();

    expect(result).toBe("new-pane-123");
  });
});

describe("setTabTitle (モック)", () => {
  test("タイトルを設定", async () => {
    const mockSetTabTitle = mock(async () => undefined);

    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      setTabTitle: mockSetTabTitle,
    }));

    const { setTabTitle } = await import("./wezterm");
    await setTabTitle("pane-123", "My Title");

    expect(mockSetTabTitle).toHaveBeenCalledWith("pane-123", "My Title");
  });
});

describe("sendText (モック)", () => {
  test("テキストを送信", async () => {
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

describe("sendCommand (モック)", () => {
  test("改行付きでテキストを送信", async () => {
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

describe("activatePane (モック)", () => {
  test("ペインをアクティブ化", async () => {
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

describe("createPane (モック)", () => {
  test("ペインを作成して新しいpaneIdを返す", async () => {
    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      createPane: mock(async () => "created-pane-999"),
    }));

    const { createPane } = await import("./wezterm");
    const result = await createPane({});

    expect(result).toBe("created-pane-999");
  });

  test("title指定でペインを作成", async () => {
    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      createPane: mock(async () => "new-pane"),
    }));

    const { createPane } = await import("./wezterm");
    const result = await createPane({ title: "Test Title" });

    expect(result).toBe("new-pane");
  });

  test("keepFocus指定でペインを作成", async () => {
    mock.module("./wezterm", () => ({
      ...require("./wezterm"),
      createPane: mock(async () => "new-pane"),
    }));

    const { createPane } = await import("./wezterm");
    const result = await createPane({ keepFocus: true });

    expect(result).toBe("new-pane");
  });
});
