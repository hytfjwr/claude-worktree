import { describe, expect, test } from "bun:test";
import { lerp, shimmerText, smoothstep, startSpinner } from "./spinner";

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

describe("lerp", () => {
  test("t=0 のとき a を返す", () => {
    expect(lerp(0, 100, 0)).toBe(0);
  });

  test("t=1 のとき b を返す", () => {
    expect(lerp(0, 100, 1)).toBe(100);
  });

  test("t=0.5 のとき中間値を返す", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });
});

describe("smoothstep", () => {
  test("t=0 のとき 0 を返す", () => {
    expect(smoothstep(0)).toBe(0);
  });

  test("t=1 のとき 1 を返す", () => {
    expect(smoothstep(1)).toBe(1);
  });

  test("t=0.5 のとき 0.5 を返す", () => {
    expect(smoothstep(0.5)).toBe(0.5);
  });

  test("0 < t < 0.5 のとき t より小さい値を返す（ease-in）", () => {
    const t = 0.25;
    expect(smoothstep(t)).toBeLessThan(t);
  });

  test("0.5 < t < 1 のとき t より大きい値を返す（ease-out）", () => {
    const t = 0.75;
    expect(smoothstep(t)).toBeGreaterThan(t);
  });
});

describe("shimmerText", () => {
  test("ANSI カラーコードを含む文字列を返す", () => {
    const result = shimmerText("hello", 2);
    expect(result).toContain("\x1b[38;2;");
    expect(result).toContain("\x1b[0m");
  });

  test("元のテキストの全文字を含む", () => {
    const result = shimmerText("ABC", 1);
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });

  test("日本語テキストでも動作する", () => {
    const result = shimmerText("処理中", 1);
    expect(result).toContain("処");
    expect(result).toContain("理");
    expect(result).toContain("中");
  });

  test("shimmerPos が遠い場合すべてベースカラーになる", () => {
    const result = shimmerText("AB", 100);
    // Both chars should be base color (120, 110, 170)
    const baseColorCode = "\x1b[38;2;120;110;170m";
    const count = result.split(baseColorCode).length - 1;
    expect(count).toBe(2);
  });
});
