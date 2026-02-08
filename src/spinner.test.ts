import { describe, expect, test } from "bun:test";
import { startSpinner } from "./spinner";

describe("startSpinner", () => {
  test("Spinner オブジェクトを返す", () => {
    const spinner = startSpinner("テスト中...");
    expect(spinner).toHaveProperty("stop");
    expect(spinner).toHaveProperty("fail");
    expect(typeof spinner.stop).toBe("function");
    expect(typeof spinner.fail).toBe("function");
    spinner.stop();
  });

  test("stop() を正常に呼べる", () => {
    const spinner = startSpinner("処理中...");
    expect(() => spinner.stop()).not.toThrow();
  });

  test("stop() にメッセージを渡せる", () => {
    const spinner = startSpinner("処理中...");
    expect(() => spinner.stop("完了しました")).not.toThrow();
  });

  test("fail() を正常に呼べる", () => {
    const spinner = startSpinner("処理中...");
    expect(() => spinner.fail("エラーが発生しました")).not.toThrow();
  });
});
