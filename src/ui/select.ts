import * as readline from "node:readline";

import { padToWidth, stringWidth, truncateToWidth } from "../core/width.ts";
import type { SelectItem, Viewport } from "../types/index.ts";
import { cyan, dim, green } from "./color.ts";
import { icons } from "./icons.ts";
import { logInfo } from "./logger.ts";

export type { SelectItem } from "../types/index.ts";

// =============================================================================
// Types
// =============================================================================

type SelectMode = "single" | "multi";

type SelectOptions<T> = {
  message: string;
  items: SelectItem<T>[];
};

/** Immutable per-run context. */
type SelectContext<T> = {
  message: string;
  items: SelectItem<T>[];
  mode: SelectMode;
  labelWidth: number;
};

/** Mutable state driven by key input. */
type SelectState = {
  /** Item indices currently on display, in original order. */
  visible: number[];
  /** Index into `visible`, not into `items`. */
  cursor: number;
  offset: number;
  /** Original `items` indices, never display indices. */
  selected: Set<number>;
};

type SelectFrame = {
  lines: string[];
  viewport: Viewport;
};

// =============================================================================
// ANSI helpers
// =============================================================================

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_DOWN = "\x1b[J";

function moveUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : "";
}

// =============================================================================
// Key codes
// =============================================================================

type KeyAction =
  | "up"
  | "down"
  | "page_up"
  | "page_down"
  | "home"
  | "end"
  | "enter"
  | "space"
  | "toggle_all"
  | "cancel"
  | "ctrl_c"
  | "unknown";

function parseKey(data: Buffer): KeyAction {
  if (data.length === 1) {
    const byte = data[0];
    if (byte === 0x03) return "ctrl_c";
    if (byte === 0x0d) return "enter"; // CR
    if (byte === 0x0a) return "enter"; // LF
    if (byte === 0x10) return "up"; // Ctrl+P
    if (byte === 0x0e) return "down"; // Ctrl+N
    if (byte === 0x20) return "space";
    if (byte === 0x1b) return "cancel"; // Esc
    if (byte === 0x6b) return "up"; // k
    if (byte === 0x6a) return "down"; // j
    if (byte === 0x67) return "home"; // g
    if (byte === 0x47) return "end"; // G
    if (byte === 0x71) return "cancel"; // q
    if (byte === 0x61) return "toggle_all"; // a
  }
  // CSI sequences: ESC [ <params> <final>
  if (data.length >= 3 && data[0] === 0x1b && data[1] === 0x5b) {
    switch (data.toString("latin1", 2)) {
      case "A":
        return "up";
      case "B":
        return "down";
      case "5~":
        return "page_up";
      case "6~":
        return "page_down";
      case "H":
      case "1~":
      case "7~":
        return "home";
      case "F":
      case "4~":
      case "8~":
        return "end";
    }
  }
  return "unknown";
}

// =============================================================================
// Viewport
// =============================================================================

// Lines the frame spends outside the candidate window: a blank line and the
// message, the footer, two scroll indicators, and one spare line so the frame
// never fills the terminal exactly.
const CHROME_LINES = 6;
const MIN_VIEWPORT_HEIGHT = 3;
const SCROLLOFF = 1;
const DEFAULT_ROWS = 24;
const DEFAULT_COLUMNS = 80;
const MIN_FRAME_WIDTH = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Number of candidate rows that fit in the terminal. */
export function computeViewportHeight(rows: number | undefined, extraChrome = 0): number {
  return Math.max(MIN_VIEWPORT_HEIGHT, (rows || DEFAULT_ROWS) - CHROME_LINES - extraChrome);
}

/**
 * Scrolls the window so the cursor stays visible with SCROLLOFF rows of
 * context above and below, except at the ends of the list.
 */
export function computeViewport(total: number, cursor: number, height: number, currentOffset: number): Viewport {
  if (total <= 0) {
    return { offset: 0, visibleStart: 0, visibleEnd: 0, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const windowSize = Math.max(1, height);
  if (total <= windowSize) {
    return { offset: 0, visibleStart: 0, visibleEnd: total, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const maxOffset = total - windowSize;
  const scrolloff = Math.min(SCROLLOFF, Math.floor((windowSize - 1) / 2));
  const safeCursor = clamp(cursor, 0, total - 1);
  let offset = clamp(currentOffset, 0, maxOffset);
  if (safeCursor - scrolloff < offset) offset = safeCursor - scrolloff;
  if (safeCursor + scrolloff > offset + windowSize - 1) offset = safeCursor + scrolloff - windowSize + 1;
  offset = clamp(offset, 0, maxOffset);
  const visibleEnd = Math.min(total, offset + windowSize);
  return { offset, visibleStart: offset, visibleEnd, hiddenAbove: offset, hiddenBelow: total - visibleEnd };
}

// =============================================================================
// Rendering
// =============================================================================

function computeLabelWidth<T>(items: SelectItem<T>[]): number {
  let max = 0;
  for (const item of items) {
    const len = stringWidth(item.label);
    if (len > max) max = len;
  }
  return max;
}

/** Plain (uncolored) metadata text shown after the label. Includes a leading two-space gap. */
function metaText<T>(mode: SelectMode, item: SelectItem<T>): string {
  if (mode === "single") {
    return item.description ? `  ${item.description}` : "";
  }
  if (item.description && item.hint) return `  ${item.description} – ${item.hint}`;
  if (item.description) return `  ${item.description}`;
  if (item.hint) return `  ${item.hint}`;
  return "";
}

/** Checkbox glyphs differ in width between color (`◼`, width 1) and plain (`[x]`, width 3) modes. */
function checkboxWidth(): number {
  return Math.max(stringWidth(icons.checked()), stringWidth(icons.unchecked()));
}

function renderRow<T>(
  ctx: SelectContext<T>,
  state: SelectState,
  itemIndex: number,
  isCurrent: boolean,
  frameWidth: number,
): string {
  const item = ctx.items[itemIndex];
  const pointer = isCurrent ? cyan(icons.cursor()) : " ";

  let checkboxCell = "";
  if (ctx.mode === "multi") {
    const isSelected = state.selected.has(itemIndex);
    const check = isSelected ? green(icons.checked()) : dim(icons.unchecked());
    checkboxCell = `${padToWidth(check, checkboxWidth())} `;
  }

  const prefixWidth = 2 + 1 + 1 + (ctx.mode === "multi" ? checkboxWidth() + 1 : 0);
  const available = Math.max(1, frameWidth - prefixWidth);
  const labelCell = Math.min(ctx.labelWidth, available);

  const labelPlain = padToWidth(truncateToWidth(item.label, labelCell), labelCell);
  const label = isCurrent ? cyan(labelPlain) : labelPlain;

  const metaRoom = available - labelCell;
  const metaPlain = metaText(ctx.mode, item);
  const meta = metaPlain && metaRoom > 2 ? dim(truncateToWidth(metaPlain, metaRoom)) : "";

  return `  ${pointer} ${checkboxCell}${label}${meta}`;
}

function footerLine<T>(ctx: SelectContext<T>, state: SelectState, frameWidth: number): string {
  const total = state.visible.length;
  const position = total > 0 ? `${state.cursor + 1}/${total}` : "0/0";
  const plain =
    ctx.mode === "single"
      ? `  ↑/↓ navigate  Enter confirm  q cancel  ${position}`
      : `  ↑/↓ navigate  Space toggle  a all  Enter confirm  q cancel  ${position}`;
  return dim(truncateToWidth(plain, frameWidth));
}

function buildFrame<T>(
  ctx: SelectContext<T>,
  state: SelectState,
  dims: { columns: number | undefined; rows: number | undefined },
): SelectFrame {
  const frameWidth = Math.max(MIN_FRAME_WIDTH, (dims.columns || DEFAULT_COLUMNS) - 1);
  const height = computeViewportHeight(dims.rows);
  const viewport = computeViewport(state.visible.length, state.cursor, height, state.offset);

  const lines: string[] = [];
  lines.push("");
  lines.push(truncateToWidth(ctx.message, frameWidth));
  if (viewport.hiddenAbove > 0) {
    lines.push(dim(`  ${icons.scrollUp()} ${viewport.hiddenAbove} more`));
  }
  for (let i = viewport.visibleStart; i < viewport.visibleEnd; i++) {
    const itemIndex = state.visible[i];
    lines.push(renderRow(ctx, state, itemIndex, i === state.cursor, frameWidth));
  }
  if (viewport.hiddenBelow > 0) {
    lines.push(dim(`  ${icons.scrollDown()} ${viewport.hiddenBelow} more`));
  }
  lines.push(footerLine(ctx, state, frameWidth));

  return { lines, viewport };
}

// =============================================================================
// Non-TTY fallback (readline-based number input)
// =============================================================================

function createRl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function fallbackSingle<T>(options: SelectOptions<T>): Promise<T | null> {
  logInfo(`\n${options.message}\n`);
  for (let i = 0; i < options.items.length; i++) {
    const item = options.items[i];
    const desc = item.description ? `  ${item.description}` : "";
    logInfo(`  ${i + 1}. ${item.label}${desc}`);
  }

  const rl = createRl();
  try {
    const answer = await question(rl, "\nSelection (number, empty to cancel): ");
    const input = answer.trim();
    if (!input) return null;
    const idx = Number.parseInt(input, 10) - 1;
    if (idx < 0 || idx >= options.items.length || Number.isNaN(idx)) return null;
    return options.items[idx].value;
  } finally {
    rl.close();
  }
}

async function fallbackMany<T>(options: SelectOptions<T>): Promise<T[]> {
  logInfo(`\n${options.message}`);
  logInfo("Enter numbers separated by spaces, 'all' to select all, empty to cancel\n");
  for (let i = 0; i < options.items.length; i++) {
    const item = options.items[i];
    const hint = item.hint ? `  (${item.hint})` : "";
    logInfo(`  ${i + 1}. ${item.label}${hint}`);
  }

  const rl = createRl();
  try {
    const answer = await question(rl, "\nSelection: ");
    const input = answer.trim().toLowerCase();
    if (!input) return [];
    if (input === "all") return options.items.map((it) => it.value);
    const indices = input
      .split(/\s+/)
      .map((s) => Number.parseInt(s, 10) - 1)
      .filter((i) => i >= 0 && i < options.items.length);
    const uniqueSortedIndices = Array.from(new Set(indices)).sort((a, b) => a - b);
    return uniqueSortedIndices.map((i) => options.items[i].value);
  } finally {
    rl.close();
  }
}

// =============================================================================
// TTY select (raw mode)
// =============================================================================

/**
 * Runs the interactive selector in raw mode. Resolves with the final state, or
 * null when the user cancels.
 */
function runInteractive<T>(ctx: SelectContext<T>): Promise<SelectState | null> {
  return new Promise((resolve) => {
    const state: SelectState = {
      visible: ctx.items.map((_, i) => i),
      cursor: 0,
      offset: 0,
      selected: new Set(),
    };
    let renderedLines = 0;
    let resolved = false;

    const write = (s: string) => process.stdout.write(s);

    const viewportHeight = () => computeViewportHeight(process.stdout.rows);

    const draw = () => {
      // Move up to overwrite previous render
      if (renderedLines > 0) {
        write(moveUp(renderedLines));
      }
      write(`\r${CLEAR_DOWN}`);

      const frame = buildFrame(ctx, state, { columns: process.stdout.columns, rows: process.stdout.rows });
      state.offset = frame.viewport.offset; // persist the scrolled position
      write(`${frame.lines.join("\n")}\n`);
      renderedLines = frame.lines.length;
    };

    const toggleCurrent = () => {
      if (ctx.mode !== "multi") return;
      const itemIndex = state.visible[state.cursor];
      if (state.selected.has(itemIndex)) {
        state.selected.delete(itemIndex);
      } else {
        state.selected.add(itemIndex);
      }
      draw();
    };

    const toggleAll = () => {
      if (ctx.mode !== "multi") return;
      if (state.selected.size === ctx.items.length) {
        state.selected.clear();
      } else {
        for (let i = 0; i < ctx.items.length; i++) state.selected.add(i);
      }
      draw();
    };

    const onResize = () => {
      // The previously rendered height is no longer trustworthy after a resize,
      // so draw a fresh frame instead of moving up over the old one.
      renderedLines = 0;
      draw();
    };

    const cleanup = () => {
      if (stdinHandler) {
        process.stdin.removeListener("data", stdinHandler);
        stdinHandler = null;
      }
      process.removeListener("SIGWINCH", onResize);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
      // Clear the rendered UI
      if (renderedLines > 0) {
        write(moveUp(renderedLines));
      }
      write(`\r${CLEAR_DOWN}${SHOW_CURSOR}`);
    };

    const finish = (result: SelectState | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      process.removeListener("exit", exitHandler);
      resolve(result);
    };

    const exitHandler = () => {
      if (!resolved) {
        // Restore terminal on abnormal exit
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false);
          } catch {}
        }
        process.stdout.write(SHOW_CURSOR);
      }
    };

    const applyAction = (action: KeyAction) => {
      if (action === "ctrl_c") {
        cleanup();
        process.removeListener("exit", exitHandler);
        process.exit(130);
      }

      const total = state.visible.length;

      switch (action) {
        case "cancel":
          finish(null);
          break;
        case "enter":
          finish(state);
          break;
        case "up":
          state.cursor = state.cursor <= 0 ? total - 1 : state.cursor - 1;
          draw();
          break;
        case "down":
          state.cursor = state.cursor >= total - 1 ? 0 : state.cursor + 1;
          draw();
          break;
        case "page_up":
          state.cursor = clamp(state.cursor - viewportHeight(), 0, total - 1);
          draw();
          break;
        case "page_down":
          state.cursor = clamp(state.cursor + viewportHeight(), 0, total - 1);
          draw();
          break;
        case "home":
          state.cursor = 0;
          draw();
          break;
        case "end":
          state.cursor = total - 1;
          draw();
          break;
        case "space":
          toggleCurrent();
          break;
        case "toggle_all":
          toggleAll();
          break;
        default:
          break;
      }
    };

    let stdinHandler: ((data: Buffer) => void) | null = (data: Buffer) => {
      applyAction(parseKey(data));
    };

    process.on("exit", exitHandler);

    // Start
    write(HIDE_CURSOR);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", stdinHandler);
    process.on("SIGWINCH", onResize);
    draw();
  });
}

// =============================================================================
// Public API
// =============================================================================

export async function selectSingle<T>(options: SelectOptions<T>): Promise<T | null> {
  const { items, message } = options;
  if (items.length === 0) return null;
  if (!process.stdin.isTTY) return fallbackSingle(options);

  const state = await runInteractive<T>({
    message,
    items,
    mode: "single",
    labelWidth: computeLabelWidth(items),
  });
  if (!state) return null;
  return items[state.visible[state.cursor]].value;
}

export async function selectMany<T>(options: SelectOptions<T>): Promise<T[]> {
  const { items, message } = options;
  if (items.length === 0) return [];
  if (!process.stdin.isTTY) return fallbackMany(options);

  const state = await runInteractive<T>({
    message,
    items,
    mode: "multi",
    labelWidth: computeLabelWidth(items),
  });
  if (!state) return [];
  return items.filter((_, i) => state.selected.has(i)).map((item) => item.value);
}
