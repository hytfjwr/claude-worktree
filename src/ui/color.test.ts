import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { saveEnv, withTTY } from "../__test-utils__.ts";
import {
  _resetColorCache,
  blue,
  bold,
  colorize,
  cyan,
  dim,
  green,
  isColorEnabled,
  magenta,
  rawCode,
  shouldUseColor,
  styles,
  yellow,
} from "./color.ts";

let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = saveEnv("NO_COLOR");
});

afterEach(() => {
  restoreEnv();
  _resetColorCache();
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

describe("color wrapper functions", () => {
  test("return plain text when color is disabled", () => {
    process.env.NO_COLOR = "1";
    _resetColorCache();
    expect(bold("hello")).toBe("hello");
    expect(dim("hello")).toBe("hello");
    expect(green("hello")).toBe("hello");
    expect(yellow("hello")).toBe("hello");
    expect(blue("hello")).toBe("hello");
    expect(magenta("hello")).toBe("hello");
    expect(cyan("hello")).toBe("hello");
  });

  test("wrap text with ANSI codes when color is enabled", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      expect(bold("hi")).toBe("\x1b[1mhi\x1b[0m");
      expect(dim("hi")).toBe("\x1b[38;5;245mhi\x1b[0m");
      expect(green("hi")).toBe("\x1b[32mhi\x1b[0m");
      expect(yellow("hi")).toBe("\x1b[33mhi\x1b[0m");
      expect(blue("hi")).toBe("\x1b[34mhi\x1b[0m");
      expect(magenta("hi")).toBe("\x1b[35mhi\x1b[0m");
      expect(cyan("hi")).toBe("\x1b[36mhi\x1b[0m");
    });
  });
});

describe("colorize", () => {
  test("returns plain text when color is disabled", () => {
    process.env.NO_COLOR = "1";
    _resetColorCache();
    expect(colorize("\x1b[36m", "hello")).toBe("hello");
  });

  test("returns plain text when code is empty", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      expect(colorize("", "hello")).toBe("hello");
    });
  });

  test("wraps text with given code when color is enabled", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      expect(colorize("\x1b[36m", "hello")).toBe("\x1b[36mhello\x1b[0m");
    });
  });
});

describe("styles", () => {
  test("returns plain text when color is disabled", () => {
    process.env.NO_COLOR = "1";
    _resetColorCache();
    expect(styles("hello", "bold", "cyan")).toBe("hello");
  });

  test("applies multiple styles when color is enabled", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      expect(styles("hi", "bold", "cyan")).toBe("\x1b[1m\x1b[36mhi\x1b[0m");
    });
  });
});
