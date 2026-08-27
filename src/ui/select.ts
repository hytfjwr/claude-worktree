import * as readline from "node:readline";

import { padToWidth, stringWidth, truncateToWidth } from "../core/width.ts";
import type { FilterMatch, SelectItem, Viewport } from "../types/index.ts";
import { cyan, dim, green, styles } from "./color.ts";
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
  /** Matches currently on display, in original item order. */
  visible: FilterMatch[];
  /** Index into `visible`, not into `items`. */
  cursor: number;
  offset: number;
  /** Original `items` indices, never display indices. */
  selected: Set<number>;
  /** Current filter query. Kept when filter input mode is left with Enter. */
  query: string;
  /** True while typing into the filter query. */
  filtering: boolean;
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
  | "filter"
  | "backspace"
  | "ctrl_u"
  | "unknown";

/** Handles control bytes and CSI sequences only. Printable text is decoded by `printableText`. */
function parseKey(data: Buffer): KeyAction {
  if (data.length === 1) {
    const byte = data[0];
    if (byte === 0x03) return "ctrl_c";
    if (byte === 0x0d) return "enter"; // CR
    if (byte === 0x0a) return "enter"; // LF
    if (byte === 0x10) return "up"; // Ctrl+P
    if (byte === 0x0e) return "down"; // Ctrl+N
    if (byte === 0x1b) return "cancel"; // Esc
    if (byte === 0x08) return "backspace";
    if (byte === 0x7f) return "backspace";
    if (byte === 0x15) return "ctrl_u"; // Ctrl+U
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

/**
 * Decodes the buffer as filter text. Returns null unless every byte is
 * printable, so control bytes and escape sequences fall through to parseKey.
 */
function printableText(data: Buffer): string | null {
  if (data.length === 0) return null;
  for (const byte of data) {
    if (byte < 0x20 || byte === 0x7f) return null;
  }
  return data.toString("utf8");
}

/** Navigation meaning of a printable character outside filter input mode. */
function navAction(char: string): KeyAction | null {
  switch (char) {
    case " ":
      return "space";
    case "j":
      return "down";
    case "k":
      return "up";
    case "g":
      return "home";
    case "G":
      return "end";
    case "q":
      return "cancel";
    case "a":
      return "toggle_all";
    case "/":
      return "filter";
    default:
      return null;
  }
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
// Filtering
// =============================================================================

/**
 * Case-insensitive subsequence match. Returns the code point indices of `text`
 * that the query consumed, or null when `query` is not a subsequence of `text`.
 * An empty query matches everything with no positions.
 */
export function fuzzyMatch(text: string, query: string): number[] | null {
  if (query === "") return [];
  const chars = [...text];
  const needle = [...query.toLowerCase()];
  const positions: number[] = [];
  let qi = 0;
  for (let i = 0; i < chars.length && qi < needle.length; i++) {
    if (chars[i].toLowerCase() === needle[qi]) {
      positions.push(i);
      qi++;
    }
  }
  return qi === needle.length ? positions : null;
}

/**
 * Items whose label, description or hint contains the query as a subsequence,
 * in original order. Order is never rescored, so the display stays predictable.
 */
export function filterItems<T>(items: SelectItem<T>[], query: string): FilterMatch[] {
  if (query === "") return items.map((_, index) => ({ index, labelMatches: [] }));
  const matches: FilterMatch[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const labelMatches = fuzzyMatch(item.label, query);
    if (labelMatches !== null) {
      matches.push({ index, labelMatches });
      continue;
    }
    if (fuzzyMatch(item.description ?? "", query) !== null || fuzzyMatch(item.hint ?? "", query) !== null) {
      matches.push({ index, labelMatches: [] });
    }
  }
  return matches;
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

/**
 * Colors the label one run at a time: matched code points get the highlight
 * style, the rest gets the cursor color. Runs are wrapped separately because
 * nesting color wrappers would reset the outer color mid-string.
 */
function styleLabel(labelPlain: string, matches: readonly number[], isCurrent: boolean): string {
  if (matches.length === 0) return isCurrent ? cyan(labelPlain) : labelPlain;
  const matched = new Set(matches);
  const chars = [...labelPlain];
  let out = "";
  let runStart = 0;
  const flush = (end: number, isMatch: boolean) => {
    if (end <= runStart) return;
    const run = chars.slice(runStart, end).join("");
    if (isMatch) out += styles(run, "cyan", "bold");
    else out += isCurrent ? cyan(run) : run;
    runStart = end;
  };
  for (let i = 1; i <= chars.length; i++) {
    const prevIsMatch = matched.has(i - 1);
    if (i === chars.length || matched.has(i) !== prevIsMatch) {
      flush(i, prevIsMatch);
    }
  }
  return out;
}

function renderRow<T>(
  ctx: SelectContext<T>,
  state: SelectState,
  itemIndex: number,
  isCurrent: boolean,
  frameWidth: number,
  matches: readonly number[],
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
  const label = styleLabel(labelPlain, matches, isCurrent);

  const metaRoom = available - labelCell;
  const metaPlain = metaText(ctx.mode, item);
  const meta = metaPlain && metaRoom > 2 ? dim(truncateToWidth(metaPlain, metaRoom)) : "";

  return `  ${pointer} ${checkboxCell}${label}${meta}`;
}

/** Query and match count, shown above the candidates while a filter is active. */
function filterLine<T>(ctx: SelectContext<T>, state: SelectState, frameWidth: number): string {
  const prefix = "  Filter: ";
  const counts = `(${state.visible.length}/${ctx.items.length})`;
  const caret = state.filtering ? icons.caret() : "";
  const room = Math.max(1, frameWidth - stringWidth(prefix) - stringWidth(counts) - 2);
  const shown = truncateToWidth(`${state.query}${caret}`, room);
  return `${dim(prefix)}${cyan(shown)}  ${dim(counts)}`;
}

function footerLine<T>(ctx: SelectContext<T>, state: SelectState, frameWidth: number): string {
  const total = state.visible.length;
  const position = total > 0 ? `${state.cursor + 1}/${total}` : "0/0";
  let plain: string;
  if (state.filtering) {
    plain = `  Type to filter  Enter accept  Esc discard  Ctrl+U clear  ↑/↓ navigate  ${position}`;
  } else if (ctx.mode === "single") {
    plain = `  ↑/↓ navigate  Enter confirm  / filter${state.query ? "  Esc clear" : ""}  q cancel  ${position}`;
  } else {
    const allLabel = state.query ? "all matches" : "all";
    const clearHint = state.query ? "  Esc clear" : "";
    plain = `  ↑/↓ navigate  Space toggle  a ${allLabel}  / filter${clearHint}  Enter confirm  q cancel  ${position}`;
  }
  return dim(truncateToWidth(plain, frameWidth));
}

function buildFrame<T>(
  ctx: SelectContext<T>,
  state: SelectState,
  dims: { columns: number | undefined; rows: number | undefined },
): SelectFrame {
  const frameWidth = Math.max(MIN_FRAME_WIDTH, (dims.columns || DEFAULT_COLUMNS) - 1);
  const showFilter = state.filtering || state.query !== "";
  const height = computeViewportHeight(dims.rows, showFilter ? 1 : 0);
  const viewport = computeViewport(state.visible.length, state.cursor, height, state.offset);

  const lines: string[] = [];
  lines.push("");
  lines.push(truncateToWidth(ctx.message, frameWidth));
  if (showFilter) {
    lines.push(filterLine(ctx, state, frameWidth));
  }
  if (state.visible.length === 0) {
    lines.push(dim("  no matches"));
  } else {
    if (viewport.hiddenAbove > 0) {
      lines.push(dim(`  ${icons.scrollUp()} ${viewport.hiddenAbove} more`));
    }
    for (let i = viewport.visibleStart; i < viewport.visibleEnd; i++) {
      const match = state.visible[i];
      lines.push(renderRow(ctx, state, match.index, i === state.cursor, frameWidth, match.labelMatches));
    }
    if (viewport.hiddenBelow > 0) {
      lines.push(dim(`  ${icons.scrollDown()} ${viewport.hiddenBelow} more`));
    }
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
      visible: filterItems(ctx.items, ""),
      cursor: 0,
      offset: 0,
      selected: new Set(),
      query: "",
      filtering: false,
    };
    let renderedLines = 0;
    let resolved = false;

    const write = (s: string) => process.stdout.write(s);

    const viewportHeight = () =>
      computeViewportHeight(process.stdout.rows, state.filtering || state.query !== "" ? 1 : 0);

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
      if (ctx.mode !== "multi" || state.visible.length === 0) return;
      const itemIndex = state.visible[state.cursor].index;
      if (state.selected.has(itemIndex)) {
        state.selected.delete(itemIndex);
      } else {
        state.selected.add(itemIndex);
      }
      draw();
    };

    // Toggles only the matches currently on display, so a filtered "select all"
    // never touches items hidden by the filter.
    const toggleAll = () => {
      if (ctx.mode !== "multi") return;
      const indices = state.visible.map((m) => m.index);
      const allSelected = indices.length > 0 && indices.every((i) => state.selected.has(i));
      for (const i of indices) {
        if (allSelected) state.selected.delete(i);
        else state.selected.add(i);
      }
      draw();
    };

    // Recomputes the visible matches, keeping the cursor on the same item when it survives.
    const setQuery = (query: string) => {
      const anchor = state.visible[state.cursor]?.index;
      state.query = query;
      state.visible = filterItems(ctx.items, query);
      const next = anchor === undefined ? -1 : state.visible.findIndex((m) => m.index === anchor);
      state.cursor = next >= 0 ? next : clamp(state.cursor, 0, Math.max(0, state.visible.length - 1));
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

    // Enter leaves filter input mode (keeping the query) instead of confirming,
    // and never confirms an empty match list.
    const acceptEnter = () => {
      if (state.filtering) {
        state.filtering = false;
        draw();
        return;
      }
      if (state.visible.length === 0) return;
      finish(state);
    };

    // Esc steps back to the unfiltered list while a filter is showing (typing or a kept
    // query), and only cancels the whole prompt once there is nothing left to discard.
    const applyCancel = () => {
      if (state.filtering || state.query !== "") {
        state.filtering = false;
        setQuery("");
        draw();
        return;
      }
      finish(null);
    };

    const eraseFilterChar = () => {
      if (!state.filtering || state.query === "") return;
      setQuery([...state.query].slice(0, -1).join(""));
      draw();
    };

    const clearFilter = () => {
      if (state.query === "") return;
      setQuery("");
      draw();
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
          applyCancel();
          break;
        case "enter":
          acceptEnter();
          break;
        case "filter":
          state.filtering = true;
          draw();
          break;
        case "backspace":
          eraseFilterChar();
          break;
        case "ctrl_u":
          clearFilter();
          break;
        case "up":
          if (total === 0) break;
          state.cursor = state.cursor <= 0 ? total - 1 : state.cursor - 1;
          draw();
          break;
        case "down":
          if (total === 0) break;
          state.cursor = state.cursor >= total - 1 ? 0 : state.cursor + 1;
          draw();
          break;
        case "page_up":
          if (total === 0) break;
          state.cursor = clamp(state.cursor - viewportHeight(), 0, total - 1);
          draw();
          break;
        case "page_down":
          if (total === 0) break;
          state.cursor = clamp(state.cursor + viewportHeight(), 0, total - 1);
          draw();
          break;
        case "home":
          if (total === 0) break;
          state.cursor = 0;
          draw();
          break;
        case "end":
          if (total === 0) break;
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
      const text = printableText(data);
      if (text !== null) {
        if (state.filtering) {
          setQuery(state.query + text);
          draw();
          return;
        }
        for (const char of text) {
          const action = navAction(char);
          if (action) applyAction(action);
        }
        return;
      }
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
  return items[state.visible[state.cursor].index].value;
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
