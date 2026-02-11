import { afterEach, describe, expect, test } from "vitest";

import { _resetColorCache } from "./color.ts";
import { icons } from "./icons.ts";

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

describe("icons", () => {
  test("returns plain ASCII when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    _resetColorCache();

    expect(icons.success()).toBe("*");
    expect(icons.fail()).toBe("x");
    expect(icons.warning()).toBe("!");
    expect(icons.done()).toBe("[done]");
    expect(icons.error()).toBe("[error]");
    expect(icons.pin()).toBe("[pin]");
    expect(icons.tree()).toBe("[tree]");
    expect(icons.branch()).toBe("[branch]");
    expect(icons.folder()).toBe("[folder]");
    expect(icons.clipboard()).toBe("[clipboard]");
    expect(icons.memo()).toBe("[memo]");
    expect(icons.merge()).toBe("[merge]");
    expect(icons.trash()).toBe("[trash]");
    expect(icons.window()).toBe("[window]");
    expect(icons.sparkle()).toBe("[sparkle]");
    expect(icons.lock()).toBe("[lock]");
    expect(icons.bullet()).toBe("*");
    expect(icons.active()).toBe("*");
    expect(icons.inactive()).toBe("o");
  });

  test("returns rich Unicode when color is enabled", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();

      expect(icons.success()).toBe("\u2713");
      expect(icons.fail()).toBe("\u2717");
      expect(icons.done()).toBe("\u2705");
      expect(icons.error()).toBe("\u274c");
      expect(icons.bullet()).toBe("\u2022");
      expect(icons.active()).toBe("\u25cf");
      expect(icons.inactive()).toBe("\u25cb");
    });
  });
});
