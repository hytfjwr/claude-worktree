import { describe, expect, test } from "vitest";

import { parseInput } from "./input-parser.ts";

// =============================================================================
// Test helpers
// =============================================================================

function parse(...bytes: number[]) {
  return parseInput(Buffer.from(bytes));
}

/** Builds an escape sequence from a string, e.g. esc("[A") for ESC [ A. */
function esc(seq: string) {
  return parseInput(Buffer.from(`\x1b${seq}`, "latin1"));
}

// =============================================================================
// Single keys
// =============================================================================

describe("single keys", () => {
  test("a printable byte becomes a text action", () => {
    const result = parse(0x61);
    expect(result.actions).toEqual([{ kind: "text", text: "a" }]);
    expect(result.rest.length).toBe(0);
  });

  test("CR and LF both decode as enter", () => {
    expect(parse(0x0d).actions).toEqual([{ kind: "key", key: "enter" }]);
    expect(parse(0x0a).actions).toEqual([{ kind: "key", key: "enter" }]);
  });

  test("0x03 decodes as ctrl_c", () => {
    expect(parse(0x03).actions).toEqual([{ kind: "key", key: "ctrl_c" }]);
  });

  test("DEL and 0x08 both decode as backspace", () => {
    expect(parse(0x7f).actions).toEqual([{ kind: "key", key: "backspace" }]);
    expect(parse(0x08).actions).toEqual([{ kind: "key", key: "backspace" }]);
  });

  test("ctrl_u, ctrl_p and ctrl_n", () => {
    expect(parse(0x15).actions).toEqual([{ kind: "key", key: "ctrl_u" }]);
    expect(parse(0x10).actions).toEqual([{ kind: "key", key: "ctrl_p" }]);
    expect(parse(0x0e).actions).toEqual([{ kind: "key", key: "ctrl_n" }]);
  });

  test("a lone ESC at the end of the buffer decodes as escape", () => {
    expect(parse(0x1b).actions).toEqual([{ kind: "key", key: "escape" }]);
  });

  test("an unsupported control byte produces no action", () => {
    expect(parse(0x01).actions).toEqual([]);
  });
});

// =============================================================================
// CSI keys
// =============================================================================

describe("CSI keys", () => {
  test("arrow keys", () => {
    expect(esc("[A").actions).toEqual([{ kind: "key", key: "up" }]);
    expect(esc("[B").actions).toEqual([{ kind: "key", key: "down" }]);
    expect(esc("[C").actions).toEqual([{ kind: "key", key: "right" }]);
    expect(esc("[D").actions).toEqual([{ kind: "key", key: "left" }]);
  });

  test("page up and page down", () => {
    expect(esc("[5~").actions).toEqual([{ kind: "key", key: "page_up" }]);
    expect(esc("[6~").actions).toEqual([{ kind: "key", key: "page_down" }]);
  });

  test("home and end via the ~ form", () => {
    expect(esc("[1~").actions).toEqual([{ kind: "key", key: "home" }]);
    expect(esc("[7~").actions).toEqual([{ kind: "key", key: "home" }]);
    expect(esc("[4~").actions).toEqual([{ kind: "key", key: "end" }]);
    expect(esc("[8~").actions).toEqual([{ kind: "key", key: "end" }]);
  });

  test("home and end via the letter form", () => {
    expect(esc("[H").actions).toEqual([{ kind: "key", key: "home" }]);
    expect(esc("[F").actions).toEqual([{ kind: "key", key: "end" }]);
  });

  test("an unknown CSI sequence produces no action and does not throw", () => {
    expect(() => esc("[Z")).not.toThrow();
    expect(esc("[Z").actions).toEqual([]);
  });
});

// =============================================================================
// Concatenation and splitting
// =============================================================================

describe("concatenation and splitting", () => {
  test("down arrow, then 'j', then Enter in one buffer decode as three actions in order", () => {
    const result = parse(0x1b, 0x5b, 0x42, 0x6a, 0x0d);
    expect(result.actions).toEqual([
      { kind: "key", key: "down" },
      { kind: "text", text: "j" },
      { kind: "key", key: "enter" },
    ]);
  });

  test("a run of printable bytes becomes a single text action", () => {
    const result = parse(0x61, 0x62, 0x63);
    expect(result.actions).toEqual([{ kind: "text", text: "abc" }]);
  });

  test("text interrupted by a control byte splits into separate actions", () => {
    const result = parse(0x61, 0x62, 0x0d, 0x63, 0x64);
    expect(result.actions).toEqual([
      { kind: "text", text: "ab" },
      { kind: "key", key: "enter" },
      { kind: "text", text: "cd" },
    ]);
  });

  test("a CSI sequence split across two chunks is completed once the rest arrives", () => {
    const first = parseInput(Buffer.from([0x1b, 0x5b]));
    expect(first.actions).toEqual([]);
    expect(first.rest.length).toBe(2);

    const second = parseInput(Buffer.concat([first.rest, Buffer.from([0x41])]));
    expect(second.actions).toEqual([{ kind: "key", key: "up" }]);
  });

  test("a mouse sequence split across two chunks is completed once the final byte arrives", () => {
    const first = parseInput(Buffer.from("\x1b[<0;10;5", "latin1"));
    expect(first.actions).toEqual([]);
    expect(first.rest.length).toBeGreaterThan(0);

    const second = parseInput(Buffer.concat([first.rest, Buffer.from("M", "latin1")]));
    expect(second.actions).toEqual([{ kind: "mouse", button: "left", pressed: true, motion: false, x: 10, y: 5 }]);
  });

  test("a UTF-8 character split across two chunks is held back until it is complete", () => {
    const bytes = Buffer.from("あ", "utf8");
    expect(bytes.length).toBe(3);

    const first = parseInput(bytes.subarray(0, 2));
    expect(first.actions).toEqual([]);
    expect(first.rest.length).toBe(2);

    const second = parseInput(Buffer.concat([first.rest, bytes.subarray(2)]));
    expect(second.actions).toEqual([{ kind: "text", text: "あ" }]);
  });

  test("a complete UTF-8 character is not held back", () => {
    const bytes = Buffer.from("あ", "utf8");
    const result = parseInput(bytes);
    expect(result.actions).toEqual([{ kind: "text", text: "あ" }]);
    expect(result.rest.length).toBe(0);
  });

  test("ESC at the end of the buffer after other text decodes as escape", () => {
    const result = parse(0x6a, 0x1b);
    expect(result.actions).toEqual([
      { kind: "text", text: "j" },
      { kind: "key", key: "escape" },
    ]);
  });
});

// =============================================================================
// SGR mouse reports
// =============================================================================

describe("SGR mouse reports", () => {
  test("a left button press", () => {
    expect(esc("[<0;10;5M").actions).toEqual([
      { kind: "mouse", button: "left", pressed: true, motion: false, x: 10, y: 5 },
    ]);
  });

  test("a left button release", () => {
    expect(esc("[<0;10;5m").actions).toEqual([
      { kind: "mouse", button: "left", pressed: false, motion: false, x: 10, y: 5 },
    ]);
  });

  test("wheel up", () => {
    expect(esc("[<64;1;1M").actions).toEqual([
      { kind: "mouse", button: "wheel_up", pressed: true, motion: false, x: 1, y: 1 },
    ]);
  });

  test("wheel down", () => {
    expect(esc("[<65;1;1M").actions).toEqual([
      { kind: "mouse", button: "wheel_down", pressed: true, motion: false, x: 1, y: 1 },
    ]);
  });

  test("middle and right clicks", () => {
    expect(esc("[<1;1;1M").actions).toEqual([
      { kind: "mouse", button: "middle", pressed: true, motion: false, x: 1, y: 1 },
    ]);
    expect(esc("[<2;1;1M").actions).toEqual([
      { kind: "mouse", button: "right", pressed: true, motion: false, x: 1, y: 1 },
    ]);
  });

  test("the motion bit marks a drag", () => {
    expect(esc("[<32;4;7M").actions).toEqual([
      { kind: "mouse", button: "left", pressed: true, motion: true, x: 4, y: 7 },
    ]);
  });

  test("a report missing a coordinate produces no action and does not throw", () => {
    expect(() => esc("[<0;1M")).not.toThrow();
    expect(esc("[<0;1M").actions).toEqual([]);
  });
});

// =============================================================================
// Cursor position reports
// =============================================================================

describe("cursor position reports", () => {
  test("a plain report", () => {
    expect(esc("[12;40R").actions).toEqual([{ kind: "cursor_position", row: 12, col: 40 }]);
  });

  test("a report prefixed with '?'", () => {
    expect(esc("[?12;40R").actions).toEqual([{ kind: "cursor_position", row: 12, col: 40 }]);
  });
});
