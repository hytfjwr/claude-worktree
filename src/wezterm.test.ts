import { describe, expect, test, afterEach } from "bun:test";
import {
  getCurrentPaneId,
  splitPaneRight,
  setTabTitle,
  sendText,
  sendCommand,
  activatePane,
  createPane,
} from "./wezterm";

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

describe("sendText", () => {
  test("テキスト送信関数が存在", () => {
    expect(typeof sendText).toBe("function");
  });
});

describe("sendCommand", () => {
  test("コマンド送信関数が存在", () => {
    expect(typeof sendCommand).toBe("function");
  });
});

describe("splitPaneRight", () => {
  test("ペイン分割関数が存在", () => {
    expect(typeof splitPaneRight).toBe("function");
  });
});

describe("setTabTitle", () => {
  test("タブタイトル設定関数が存在", () => {
    expect(typeof setTabTitle).toBe("function");
  });
});

describe("activatePane", () => {
  test("ペインアクティブ化関数が存在", () => {
    expect(typeof activatePane).toBe("function");
  });
});

describe("createPane", () => {
  test("ペイン作成関数が存在", () => {
    expect(typeof createPane).toBe("function");
  });
});
