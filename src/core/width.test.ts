import { describe, expect, test } from "vitest";

import { padToWidth, stringWidth, stripAnsi, truncateToWidth } from "./width.ts";

describe("stripAnsi", () => {
  test("strips color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("passes through plain text unchanged", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });

  test("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("stringWidth", () => {
  describe("ASCII", () => {
    test("empty string has width 0", () => {
      expect(stringWidth("")).toBe(0);
    });

    test("single-width ASCII characters", () => {
      expect(stringWidth("hello")).toBe(5);
    });

    test("ASCII with a space", () => {
      expect(stringWidth("hello world")).toBe(11);
    });
  });

  describe("fullwidth and Japanese", () => {
    test("hiragana counts as width 2 per character", () => {
      expect(stringWidth("あいう")).toBe(6);
    });

    test("mixed Japanese commit message", () => {
      expect(stringWidth("日本語のコミットメッセージ")).toBe(26);
    });

    test("fullwidth latin letters (U+FF41-FF43)", () => {
      expect(stringWidth("ａｂｃ")).toBe(6);
    });

    test("mixed ASCII and Japanese", () => {
      expect(stringWidth("a日b")).toBe(4);
    });

    test("Hangul syllables", () => {
      expect(stringWidth("한글")).toBe(4);
    });

    test("fullwidth punctuation (U+3002 U+3001)", () => {
      expect(stringWidth("。、")).toBe(4);
    });
  });

  describe("emoji with Emoji_Presentation (no VS16 needed)", () => {
    test("white heavy check mark", () => {
      expect(stringWidth("✅")).toBe(2);
    });

    test("cross mark", () => {
      expect(stringWidth("❌")).toBe(2);
    });

    test("sparkles", () => {
      expect(stringWidth("✨")).toBe(2);
    });

    test("white medium star", () => {
      expect(stringWidth("⭐")).toBe(2);
    });
  });

  describe("emoji as surrogate pairs", () => {
    test("grinning face", () => {
      expect(stringWidth("\u{1F600}")).toBe(2);
    });

    test("tree (used in icons.ts)", () => {
      expect(stringWidth("\u{1F333}")).toBe(2);
    });

    test("window (used in icons.ts)", () => {
      expect(stringWidth("\u{1FA9F}")).toBe(2);
    });

    test("two consecutive emoji", () => {
      expect(stringWidth("\u{1F600}\u{1F600}")).toBe(4);
    });
  });

  describe("emoji with a variation selector", () => {
    test("warning with VS16 switches to emoji presentation (used in icons.ts)", () => {
      expect(stringWidth("⚠️")).toBe(2);
    });

    test("warning without VS16 renders as text (width 1)", () => {
      expect(stringWidth("⚠")).toBe(1);
    });

    test("trash with VS16 (used in icons.ts); UTF-16 length is 3 but width is 2", () => {
      expect(stringWidth("\u{1F5D1}️")).toBe(2);
    });

    test("length and width diverge for the trash icon", () => {
      expect("\u{1F5D1}️".length).toBe(3);
    });
  });

  describe("ZWJ sequences", () => {
    test("family emoji", () => {
      expect(stringWidth("\u{1F468}‍\u{1F469}‍\u{1F467}")).toBe(2);
    });

    test("woman technologist", () => {
      expect(stringWidth("\u{1F469}‍\u{1F4BB}")).toBe(2);
    });

    test("heart on fire", () => {
      expect(stringWidth("❤️‍\u{1F525}")).toBe(2);
    });

    test("ZWJ sequence surrounded by ASCII", () => {
      expect(stringWidth("a\u{1F469}‍\u{1F4BB}b")).toBe(4);
    });
  });

  describe("combining characters", () => {
    test("base letter plus combining acute accent", () => {
      expect(stringWidth("é")).toBe(1);
    });

    test("lone combining mark has width 0", () => {
      expect(stringWidth("́")).toBe(0);
    });

    test("café with a combining accent", () => {
      expect(stringWidth("café")).toBe(4);
    });

    test("combining sound mark inside a wide block is still zero width", () => {
      expect(stringWidth("゙")).toBe(0);
    });
  });

  describe("zero-width and control characters", () => {
    test("zero width space between letters", () => {
      expect(stringWidth("a​b")).toBe(2);
    });

    test("zero width no-break space (BOM) alone", () => {
      expect(stringWidth("﻿")).toBe(0);
    });

    test("NUL control character between letters", () => {
      expect(stringWidth("a\x00b")).toBe(2);
    });
  });

  describe("ANSI escape sequences", () => {
    test("color codes are stripped before measuring", () => {
      expect(stringWidth("\x1b[31mred\x1b[0m")).toBe(3);
    });

    test("truecolor codes around Japanese text", () => {
      expect(stringWidth("\x1b[38;2;1;2;3m日本\x1b[0m")).toBe(4);
    });
  });

  describe("invariants", () => {
    test("ASCII strings have width equal to length", () => {
      const s = "hello world";
      expect(stringWidth(s)).toBe(s.length);
    });
  });
});

describe("truncateToWidth", () => {
  describe("default ellipsis", () => {
    test("returns string unchanged when under the width budget", () => {
      expect(truncateToWidth("hello", 10)).toBe("hello");
    });

    test("returns string unchanged when exactly at the width budget", () => {
      expect(truncateToWidth("hello", 5)).toBe("hello");
    });

    test("truncates and appends the ellipsis", () => {
      const result = truncateToWidth("hello world", 8);
      expect(result).toBe("hello w…");
      expect(stringWidth(result)).toBe(8);
    });

    test("maxWidth of 1 returns just the ellipsis", () => {
      expect(truncateToWidth("hello", 1)).toBe("…");
    });

    test("maxWidth of 0 returns just the ellipsis", () => {
      expect(truncateToWidth("hello", 0)).toBe("…");
    });

    test("negative maxWidth returns just the ellipsis", () => {
      expect(truncateToWidth("hello", -3)).toBe("…");
    });

    test("empty string stays empty", () => {
      expect(truncateToWidth("", 5)).toBe("");
    });
  });

  describe("double-width character boundaries", () => {
    test("does not split a wide character mid-way", () => {
      const result = truncateToWidth("あいうえお", 5);
      expect(result).toBe("あい…");
      expect(stringWidth(result)).toBe(5);
    });

    test("falls one column short rather than splitting a wide character", () => {
      const result = truncateToWidth("あいうえお", 4);
      expect(result).toBe("あ…");
      expect(stringWidth(result)).toBe(3);
    });

    test("returns the full string when it fits exactly", () => {
      expect(truncateToWidth("あいうえお", 10)).toBe("あいうえお");
    });

    test("truncates one character short of the full string", () => {
      const result = truncateToWidth("あいうえお", 9);
      expect(result).toBe("あいうえ…");
      expect(stringWidth(result)).toBe(9);
    });
  });

  describe("cluster preservation", () => {
    test("never leaves a dangling half of a ZWJ sequence", () => {
      const result = truncateToWidth("a\u{1F469}‍\u{1F4BB}bc", 4);
      expect(stringWidth(result)).toBeLessThanOrEqual(4);
      const zwjSequence = "\u{1F469}‍\u{1F4BB}";
      const containsFull = result.includes(zwjSequence);
      const containsNone = !result.includes("\u{1F469}");
      expect(containsFull || containsNone).toBe(true);
    });

    test("does not split a combining character from its base", () => {
      expect(truncateToWidth("éxyz", 2)).toBe("é…");
    });
  });

  describe("ANSI", () => {
    test("strips ANSI before truncating", () => {
      expect(truncateToWidth("\x1b[31mhello world\x1b[0m", 8)).toBe("hello w…");
    });
  });

  describe("custom ellipsis", () => {
    test("three-character ellipsis", () => {
      expect(truncateToWidth("hello world", 8, "...")).toBe("hello...");
    });

    test("budget too small for content leaves only the ellipsis", () => {
      expect(truncateToWidth("hello", 3, "...")).toBe("...");
    });

    test("wide characters with a three-character ellipsis", () => {
      const result = truncateToWidth("あいうえお", 6, "...");
      expect(result).toBe("あ...");
      expect(stringWidth(result)).toBe(5);
    });

    test("string under budget is returned unchanged regardless of ellipsis", () => {
      expect(truncateToWidth("hello", 10, "...")).toBe("hello");
    });
  });
});

describe("padToWidth", () => {
  test("pads with trailing spaces to reach the target width", () => {
    expect(padToWidth("abc", 5)).toBe("abc  ");
  });

  test("returns the string unchanged when already at the target width", () => {
    expect(padToWidth("abc", 3)).toBe("abc");
  });

  test("does not truncate when longer than the target width", () => {
    expect(padToWidth("abc", 1)).toBe("abc");
  });

  test("pads an empty string", () => {
    expect(padToWidth("", 3)).toBe("   ");
  });

  test("accounts for wide characters when padding Japanese text", () => {
    const result = padToWidth("日本", 6);
    expect(result).toBe("日本  ");
    expect(stringWidth(result)).toBe(6);
  });

  test("accounts for wide characters when padding an emoji", () => {
    const result = padToWidth("✅", 4);
    expect(result).toBe("✅  ");
    expect(stringWidth(result)).toBe(4);
  });

  test("preserves ANSI codes while padding", () => {
    const result = padToWidth("\x1b[31mabc\x1b[0m", 5);
    expect(result).toBe("\x1b[31mabc\x1b[0m  ");
    expect(stringWidth(result)).toBe(5);
  });
});
