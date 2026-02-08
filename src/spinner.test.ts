import { describe, expect, test } from "bun:test";
import { lerp, shimmerText, smoothstep, startSpinner } from "./spinner";

describe("startSpinner", () => {
  test("returns a Spinner object", () => {
    const spinner = startSpinner("Testing...");
    expect(spinner).toHaveProperty("stop");
    expect(spinner).toHaveProperty("fail");
    expect(typeof spinner.stop).toBe("function");
    expect(typeof spinner.fail).toBe("function");
    spinner.stop();
  });

  test("stop() can be called normally", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.stop()).not.toThrow();
  });

  test("stop() accepts a message", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.stop("Completed")).not.toThrow();
  });

  test("fail() can be called normally", () => {
    const spinner = startSpinner("Processing...");
    expect(() => spinner.fail("An error occurred")).not.toThrow();
  });
});

describe("lerp", () => {
  test("returns a when t=0", () => {
    expect(lerp(0, 100, 0)).toBe(0);
  });

  test("returns b when t=1", () => {
    expect(lerp(0, 100, 1)).toBe(100);
  });

  test("returns midpoint when t=0.5", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });
});

describe("smoothstep", () => {
  test("returns 0 when t=0", () => {
    expect(smoothstep(0)).toBe(0);
  });

  test("returns 1 when t=1", () => {
    expect(smoothstep(1)).toBe(1);
  });

  test("returns 0.5 when t=0.5", () => {
    expect(smoothstep(0.5)).toBe(0.5);
  });

  test("returns value less than t for 0 < t < 0.5 (ease-in)", () => {
    const t = 0.25;
    expect(smoothstep(t)).toBeLessThan(t);
  });

  test("returns value greater than t for 0.5 < t < 1 (ease-out)", () => {
    const t = 0.75;
    expect(smoothstep(t)).toBeGreaterThan(t);
  });
});

describe("shimmerText", () => {
  test("returns string containing ANSI color codes", () => {
    const result = shimmerText("hello", 2);
    expect(result).toContain("\x1b[38;2;");
    expect(result).toContain("\x1b[0m");
  });

  test("contains all characters of original text", () => {
    const result = shimmerText("ABC", 1);
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });

  test("works with CJK text", () => {
    const result = shimmerText("Processing", 1);
    expect(result).toContain("P");
    expect(result).toContain("r");
    expect(result).toContain("o");
  });

  test("all chars become base color when shimmerPos is far away", () => {
    const result = shimmerText("AB", 100);
    // Both chars should be base color (120, 110, 170)
    const baseColorCode = "\x1b[38;2;120;110;170m";
    const count = result.split(baseColorCode).length - 1;
    expect(count).toBe(2);
  });
});
