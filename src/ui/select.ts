import * as readline from "node:readline";

import type { SelectItem } from "../types/index.ts";
import { cyan, dim, green } from "./color.ts";
import { icons } from "./icons.ts";
import { logInfo } from "./logger.ts";
import { countVisualLines, stripAnsi } from "./spinner.ts";

export type { SelectItem } from "../types/index.ts";

// =============================================================================
// Types
// =============================================================================

type SelectOptions<T> = {
  message: string;
  items: SelectItem<T>[];
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

// Arrow key escape sequences: ESC [ A/B
const KEY_UP_SEQ = [0x1b, 0x5b, 0x41];
const KEY_DOWN_SEQ = [0x1b, 0x5b, 0x42];

type KeyAction = "up" | "down" | "enter" | "space" | "toggle_all" | "cancel" | "ctrl_c" | "unknown";

function parseKey(data: Buffer): KeyAction {
  if (data.length === 1) {
    const byte = data[0];
    if (byte === 0x03) return "ctrl_c";
    if (byte === 0x0d) return "enter"; // CR
    if (byte === 0x0a) return "enter"; // LF
    if (byte === 0x20) return "space";
    if (byte === 0x1b) return "cancel"; // Esc
    if (byte === 0x6b) return "up"; // k
    if (byte === 0x6a) return "down"; // j
    if (byte === 0x71) return "cancel"; // q
    if (byte === 0x61) return "toggle_all"; // a
  }
  if (data.length === 3 && data[0] === KEY_UP_SEQ[0] && data[1] === KEY_UP_SEQ[1] && data[2] === KEY_UP_SEQ[2]) {
    return "up";
  }
  if (data.length === 3 && data[0] === KEY_DOWN_SEQ[0] && data[1] === KEY_DOWN_SEQ[1] && data[2] === KEY_DOWN_SEQ[2]) {
    return "down";
  }
  return "unknown";
}

// =============================================================================
// Rendering
// =============================================================================

function computeLabelWidth<T>(items: SelectItem<T>[]): number {
  let max = 0;
  for (const item of items) {
    const len = stripAnsi(item.label).length;
    if (len > max) max = len;
  }
  return max;
}

function renderSingle<T>(items: SelectItem<T>[], cursor: number, labelWidth: number): string {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isCurrent = i === cursor;
    const pointer = isCurrent ? cyan(icons.cursor()) : " ";
    const label = isCurrent ? cyan(item.label) : item.label;
    const padding = " ".repeat(Math.max(0, labelWidth - stripAnsi(item.label).length));
    const desc = item.description ? dim(`  ${item.description}`) : "";
    out += `  ${pointer} ${label}${padding}${desc}\n`;
  }
  return out;
}

function renderMulti<T>(items: SelectItem<T>[], cursor: number, selected: Set<number>, labelWidth: number): string {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isCurrent = i === cursor;
    const isSelected = selected.has(i);
    const pointer = isCurrent ? cyan(icons.cursor()) : " ";
    const check = isSelected ? green(icons.checked()) : dim(icons.unchecked());
    const label = isCurrent ? cyan(item.label) : item.label;
    const padding = " ".repeat(Math.max(0, labelWidth - stripAnsi(item.label).length));
    let meta = "";
    if (item.description && item.hint) {
      meta = dim(`  ${item.description} – ${item.hint}`);
    } else if (item.description) {
      meta = dim(`  ${item.description}`);
    } else if (item.hint) {
      meta = dim(`  ${item.hint}`);
    }
    out += `  ${pointer} ${check} ${label}${padding}${meta}\n`;
  }
  return out;
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

type RenderFn = (cursor: number) => string;

function runTTYSelect<R>(
  items: { length: number },
  headerLine: string,
  footerLine: string,
  renderBody: RenderFn,
  resolveResult: () => R,
  onKey?: (action: KeyAction) => boolean, // return true to re-render
): Promise<R | null> {
  return new Promise((resolve) => {
    let cursor = 0;
    let renderedLines = 0;
    let resolved = false;

    const write = (s: string) => process.stdout.write(s);

    const draw = () => {
      // Move up to overwrite previous render
      if (renderedLines > 0) {
        write(moveUp(renderedLines));
      }
      write(`\r${CLEAR_DOWN}`);

      const body = renderBody(cursor);
      const output = `${headerLine}\n${body}${footerLine}\n`;
      write(output);

      // Count visual lines rendered (accounts for line wrapping in narrow terminals)
      renderedLines = countVisualLines(output);
    };

    const cleanup = () => {
      if (stdinHandler) {
        process.stdin.removeListener("data", stdinHandler);
        stdinHandler = null;
      }
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

    const finish = (result: R | null) => {
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

    let stdinHandler: ((data: Buffer) => void) | null = (data: Buffer) => {
      const action = parseKey(data);

      if (action === "ctrl_c") {
        cleanup();
        process.removeListener("exit", exitHandler);
        process.exit(130);
      }

      if (action === "cancel") {
        finish(null);
        return;
      }

      if (action === "enter") {
        finish(resolveResult());
        return;
      }

      if (action === "up") {
        cursor = cursor <= 0 ? items.length - 1 : cursor - 1;
        draw();
        return;
      }

      if (action === "down") {
        cursor = cursor >= items.length - 1 ? 0 : cursor + 1;
        draw();
        return;
      }

      // Delegate extra keys (space, toggle_all, etc.)
      if (onKey?.(action)) {
        draw();
      }
    };

    process.on("exit", exitHandler);

    // Start
    write(HIDE_CURSOR);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", stdinHandler);
    draw();
  });
}

// =============================================================================
// Public API
// =============================================================================

export async function selectSingle<T>(options: SelectOptions<T>): Promise<T | null> {
  const { items, message } = options;
  if (items.length === 0) return null;

  if (!process.stdin.isTTY) {
    return fallbackSingle(options);
  }

  const labelWidth = computeLabelWidth(items);

  const headerLine = `\n${message}`;
  const footerLine = dim("  ↑/↓ navigate  Enter confirm  q cancel");

  let currentCursor = 0;

  return runTTYSelect(
    items,
    headerLine,
    footerLine,
    (cursor) => {
      currentCursor = cursor;
      return renderSingle(items, cursor, labelWidth);
    },
    () => items[currentCursor].value,
  );
}

export async function selectMany<T>(options: SelectOptions<T>): Promise<T[]> {
  const { items, message } = options;
  if (items.length === 0) return [];

  if (!process.stdin.isTTY) {
    return fallbackMany(options);
  }

  const labelWidth = computeLabelWidth(items);
  const selected = new Set<number>();

  const headerLine = `\n${message}`;
  const footerLine = dim("  ↑/↓ navigate  Space toggle  a all  Enter confirm  q cancel");

  let currentCursor = 0;

  const result = await runTTYSelect<T[]>(
    items,
    headerLine,
    footerLine,
    (cursor) => {
      currentCursor = cursor;
      return renderMulti(items, cursor, selected, labelWidth);
    },
    () => {
      const out: T[] = [];
      for (let i = 0; i < items.length; i++) {
        if (selected.has(i)) out.push(items[i].value);
      }
      return out;
    },
    (action) => {
      if (action === "space") {
        if (selected.has(currentCursor)) {
          selected.delete(currentCursor);
        } else {
          selected.add(currentCursor);
        }
        return true;
      }
      if (action === "toggle_all") {
        if (selected.size === items.length) {
          selected.clear();
        } else {
          for (let i = 0; i < items.length; i++) selected.add(i);
        }
        return true;
      }
      return false;
    },
  );

  return result ?? [];
}
