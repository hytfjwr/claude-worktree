import { afterEach, describe, expect, test } from "vitest";

import { _resetColorCache, isColorEnabled, rawCode, shouldUseColor } from "./color.ts";

function withTTY(isTTY: boolean, fn: () => void) {
  const saved = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (saved) {
      Object.defineProperty(process.stdout, "isTTY", saved);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    }
  }
}

afterEach(() => {
  _resetColorCache();
  delete process.env.NO_COLOR;
});

describe("shouldUseColor", () => {
  test("returns false when NO_COLOR is set to non-empty", () => {
    process.env.NO_COLOR = "1";
    expect(shouldUseColor()).toBe(false);
  });

  test("returns true when NO_COLOR is empty string and TTY", () => {
    withTTY(true, () => {
      process.env.NO_COLOR = "";
      _resetColorCache();
      expect(shouldUseColor()).toBe(true);
    });
  });

  test("returns false when stdout is not a TTY", () => {
    withTTY(false, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      expect(shouldUseColor()).toBe(false);
    });
  });

  test("returns true when TTY and NO_COLOR not set", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      expect(shouldUseColor()).toBe(true);
    });
  });
});

describe("isColorEnabled", () => {
  test("caches the result", () => {
    const first = isColorEnabled();
    const second = isColorEnabled();
    expect(first).toBe(second);
  });

  test("returns fresh value after reset", () => {
    isColorEnabled(); // cache
    _resetColorCache();
    // After reset, re-evaluates
    expect(typeof isColorEnabled()).toBe("boolean");
  });
});

describe("rawCode", () => {
  test("returns empty string when color is disabled", () => {
    process.env.NO_COLOR = "1";
    _resetColorCache();
    expect(rawCode("green")).toBe("");
    expect(rawCode("bold")).toBe("");
    expect(rawCode("reset")).toBe("");
  });

  test("returns ANSI code when color is enabled", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      expect(rawCode("green")).toBe("\x1b[32m");
      expect(rawCode("bold")).toBe("\x1b[1m");
      expect(rawCode("reset")).toBe("\x1b[0m");
      expect(rawCode("dim")).toBe("\x1b[38;5;245m");
    });
  });
});
