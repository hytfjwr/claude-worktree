/**
 * Streaming parser for raw terminal input.
 *
 * A terminal can deliver several keypresses or escape sequences in a single
 * `data` event (fast typing, pasted text), and can also split one escape
 * sequence across two `data` events (slow links, or the sequence landing on a
 * chunk boundary). `parseInput` consumes a Buffer from the front and returns
 * every action it could decode plus the trailing bytes of any sequence that
 * is still incomplete, so the caller can prepend them to the next chunk.
 */
import type { ControlKey, InputAction, MouseInput, ParseInputResult } from "../types/index.ts";

const EMPTY = Buffer.alloc(0);

const ESC = 0x1b;
const CSI_INTRODUCER = 0x5b; // "["
const DELETE = 0x7f;

// =============================================================================
// Control bytes
// =============================================================================

function controlKey(byte: number): ControlKey | null {
  switch (byte) {
    case 0x03:
      return "ctrl_c";
    case 0x0a:
    case 0x0d:
      return "enter";
    case 0x08:
    case DELETE:
      return "backspace";
    case 0x0e:
      return "ctrl_n";
    case 0x10:
      return "ctrl_p";
    case 0x15:
      return "ctrl_u";
    default:
      return null;
  }
}

// =============================================================================
// CSI sequences
// =============================================================================

type CsiSequence = { params: string; final: string; end: number };

/**
 * Reads one CSI sequence starting at `start` (which must point at ESC).
 * Returns null when the buffer ends before the final byte, so the caller can
 * keep the bytes for the next chunk.
 */
function readCsi(buf: Buffer, start: number): CsiSequence | null {
  let i = start + 2;
  while (i < buf.length) {
    const byte = buf[i];
    // Parameter and intermediate bytes
    if (byte >= 0x20 && byte <= 0x3f) {
      i++;
      continue;
    }
    // Final byte
    if (byte >= 0x40 && byte <= 0x7e) {
      return { params: buf.toString("latin1", start + 2, i), final: String.fromCharCode(byte), end: i + 1 };
    }
    // A control byte inside a CSI sequence: give up on the sequence and let the
    // caller reparse this byte on its own.
    return { params: buf.toString("latin1", start + 2, i), final: "", end: i };
  }
  return null;
}

/** Decodes an SGR mouse report (`ESC [ < button ; col ; row M|m`). */
function mouseAction(params: string, final: string): MouseInput | null {
  const fields = params.slice(1).split(";");
  const button = Number.parseInt(fields[0], 10);
  const x = Number.parseInt(fields[1], 10);
  const y = Number.parseInt(fields[2], 10);
  if (!Number.isFinite(button) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const low = button & 3;
  let kind: MouseInput["button"];
  if ((button & 64) !== 0) {
    kind = low === 0 ? "wheel_up" : low === 1 ? "wheel_down" : "other";
  } else if (low === 0) {
    kind = "left";
  } else if (low === 1) {
    kind = "middle";
  } else if (low === 2) {
    kind = "right";
  } else {
    kind = "other";
  }
  return { kind: "mouse", button: kind, pressed: final === "M", motion: (button & 32) !== 0, x, y };
}

function csiKey(params: string, final: string): ControlKey | null {
  switch (final) {
    case "A":
      return "up";
    case "B":
      return "down";
    case "C":
      return "right";
    case "D":
      return "left";
    case "H":
      return "home";
    case "F":
      return "end";
    case "~":
      switch (params) {
        case "1":
        case "7":
          return "home";
        case "4":
        case "8":
          return "end";
        case "5":
          return "page_up";
        case "6":
          return "page_down";
        default:
          return null;
      }
    default:
      return null;
  }
}

function csiAction(seq: CsiSequence): InputAction | null {
  const { params, final } = seq;
  if ((final === "M" || final === "m") && params.startsWith("<")) {
    return mouseAction(params, final);
  }
  if (final === "R") {
    // Cursor position report; some terminals prefix it with "?"
    const fields = params.replace("?", "").split(";");
    const row = Number.parseInt(fields[0], 10);
    const col = Number.parseInt(fields[1], 10);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return { kind: "cursor_position", row, col };
  }
  const key = csiKey(params, final);
  return key ? { kind: "key", key } : null;
}

// =============================================================================
// UTF-8 boundary handling
// =============================================================================

/**
 * Number of trailing bytes that begin a UTF-8 sequence the buffer does not yet
 * carry in full. Those bytes are held back so a multi-byte character split
 * across two chunks is not decoded as a replacement character.
 */
function pendingUtf8Bytes(buf: Buffer, start: number, end: number): number {
  for (let back = 1; back <= 3 && end - back >= start; back++) {
    const byte = buf[end - back];
    if ((byte & 0xc0) === 0x80) continue; // continuation byte
    const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 0;
    return needed > back ? back : 0;
  }
  return 0;
}

// =============================================================================
// Entry point
// =============================================================================

/**
 * Consumes `buf` from the front, returning the actions it holds plus the bytes
 * of any sequence that is still incomplete.
 */
export function parseInput(buf: Buffer): ParseInputResult {
  const actions: InputAction[] = [];
  let i = 0;
  while (i < buf.length) {
    const byte = buf[i];

    if (byte === ESC) {
      // A lone ESC at the very end of the buffer is a real Esc keypress; there
      // is nothing following it to make a sequence out of.
      if (i + 1 >= buf.length) {
        actions.push({ kind: "key", key: "escape" });
        i++;
        continue;
      }
      if (buf[i + 1] === CSI_INTRODUCER) {
        const seq = readCsi(buf, i);
        if (seq === null) return { actions, rest: buf.subarray(i) };
        const action = csiAction(seq);
        if (action) actions.push(action);
        i = seq.end;
        continue;
      }
      // ESC followed by anything else is a modified key we do not handle
      i += 2;
      continue;
    }

    if (byte < 0x20 || byte === DELETE) {
      const key = controlKey(byte);
      if (key) actions.push({ kind: "key", key });
      i++;
      continue;
    }

    // A run of printable bytes becomes one text action
    const start = i;
    while (i < buf.length && buf[i] >= 0x20 && buf[i] !== DELETE) i++;
    let end = i;
    if (end === buf.length) end -= pendingUtf8Bytes(buf, start, end);
    if (end > start) actions.push({ kind: "text", text: buf.toString("utf8", start, end) });
    if (end < i) return { actions, rest: buf.subarray(end) };
  }
  return { actions, rest: EMPTY };
}
