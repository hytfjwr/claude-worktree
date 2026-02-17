import type { ColorTheme, Spinner } from "../types/index.ts";
import { isColorEnabled } from "./color.ts";
import { icons } from "./icons.ts";

export type { ColorTheme } from "../types/index.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80; // ms

// Shimmer effect configuration
const SHIMMER_WIDTH = 6;
const SHIMMER_SPEED = 2; // characters per frame
const SHIMMER_PAUSE = 6; // extra dark frames between sweeps

export const COLOR_THEMES: readonly ColorTheme[] = [
  { base: { r: 120, g: 110, b: 170 }, bright: { r: 230, g: 225, b: 255 } }, // Purple
  { base: { r: 60, g: 150, b: 160 }, bright: { r: 180, g: 240, b: 255 } }, // Cyan
  { base: { r: 80, g: 160, b: 100 }, bright: { r: 180, g: 255, b: 200 } }, // Green
  { base: { r: 180, g: 120, b: 60 }, bright: { r: 255, g: 220, b: 150 } }, // Amber
  { base: { r: 170, g: 90, b: 130 }, bright: { r: 255, g: 190, b: 220 } }, // Rose
  { base: { r: 80, g: 120, b: 180 }, bright: { r: 180, g: 210, b: 255 } }, // Blue
  { base: { r: 170, g: 150, b: 60 }, bright: { r: 255, g: 240, b: 150 } }, // Gold
  { base: { r: 180, g: 90, b: 80 }, bright: { r: 255, g: 180, b: 170 } }, // Coral
];

const DEFAULT_THEME: ColorTheme = COLOR_THEMES[0];

export function pickRandomTheme(): ColorTheme {
  return COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)];
}

export function stripAnsi(str: string): string {
  // CSI sequences (including ? for cursor hide/show), OSC sequences, and simple escapes
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence matching
  return str.replace(/\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07]*(?:\x07|\x1b\\)|\[[0-9;]*m)/g, "");
}

export function formatTailLine(line: string, maxWidth: number): string {
  const stripped = stripAnsi(line);
  const safeWidth = Math.max(1, maxWidth);
  if (stripped.length > safeWidth) {
    if (safeWidth <= 1) {
      return "…";
    }
    return `${stripped.substring(0, safeWidth - 1)}…`;
  }
  return stripped;
}

export function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function shimmerText(text: string, shimmerPos: number, theme?: ColorTheme): string {
  if (!isColorEnabled()) {
    return text;
  }
  const baseColor = theme?.base ?? DEFAULT_THEME.base;
  const brightColor = theme?.bright ?? DEFAULT_THEME.bright;
  const chars = [...text];
  let result = "";
  for (let i = 0; i < chars.length; i++) {
    const distance = Math.abs(i - shimmerPos);
    const t = Math.max(0, 1 - distance / SHIMMER_WIDTH);
    const st = smoothstep(t);
    const r = lerp(baseColor.r, brightColor.r, st);
    const g = lerp(baseColor.g, brightColor.g, st);
    const b = lerp(baseColor.b, brightColor.b, st);
    result += `\x1b[38;2;${r};${g};${b}m${chars[i]}`;
  }
  result += "\x1b[0m";
  return result;
}

const TAIL_LINE_COUNT = 3;
const MAX_ALL_LINES = 10000;
const EXPANDED_RATIO = 0.8;
const DEFAULT_ROWS = 24;

export function getMaxExpandedLines(): number {
  const rows = process.stdout.rows || DEFAULT_ROWS;
  return Math.max(1, Math.floor(rows * EXPANDED_RATIO));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

export function formatInfoLine(hiddenCount: number, elapsedSec: number, timeoutSec?: number): string {
  const timeoutPart = timeoutSec != null ? ` · timeout ${formatDuration(timeoutSec)}` : "";
  if (hiddenCount > 0) {
    return `..+${hiddenCount} more lines (${formatDuration(elapsedSec)}${timeoutPart})`;
  }
  return `(${formatDuration(elapsedSec)}${timeoutPart})`;
}

const TAIL_UPDATE_INTERVAL = 1000; // 1 second

export function createTailUpdater(spinner: Spinner): (line: string) => void {
  const tailLines: string[] = [];
  const allLines: string[] = [];
  let totalCount = 0;
  let lastFlushTime = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    lastFlushTime = Date.now();
    spinner.updateTail([...tailLines], totalCount, [...allLines]);
  };

  return (line: string) => {
    if (allLines.length < MAX_ALL_LINES) {
      allLines.push(line);
    }
    tailLines.push(line);
    totalCount++;
    if (tailLines.length > TAIL_LINE_COUNT) tailLines.shift();

    // In expanded mode, update immediately without cloning arrays
    if (spinner.isExpanded()) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      lastFlushTime = Date.now();
      spinner.updateTail(tailLines, totalCount, allLines);
      return;
    }

    const now = Date.now();
    if (now - lastFlushTime >= TAIL_UPDATE_INTERVAL) {
      flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(flush, TAIL_UPDATE_INTERVAL - (now - lastFlushTime));
      flushTimer.unref();
    }
  };
}

let quietMode = false;

export function setQuietMode(enabled: boolean): void {
  quietMode = enabled;
}

export function startSpinner(message: string, options?: { timeoutSec?: number }): Spinner {
  if (quietMode) {
    return {
      stop() {},
      fail() {},
      updateTail() {},
      isExpanded() {
        return false;
      },
    };
  }

  // Non-TTY fallback: no cursor control, no animation, plain text only
  if (!process.stdout.isTTY) {
    let stopped = false;
    process.stdout.write(`- ${message}\n`);
    return {
      stop(finalMessage?: string) {
        if (stopped) return;
        stopped = true;
        process.stdout.write(`${finalMessage || `${icons.success()} ${message}`}\n`);
      },
      fail(errorMessage: string) {
        if (stopped) return;
        stopped = true;
        process.stdout.write(`${icons.fail()} ${errorMessage}\n`);
      },
      updateTail(_lines: string[], _totalCount: number, _newAllLines?: string[]) {
        // No-op in non-TTY mode
      },
      isExpanded() {
        return false;
      },
    };
  }

  const theme = pickRandomTheme();
  let frameIndex = 0;
  let shimmerPos = -SHIMMER_WIDTH;
  const chars = [...message];
  const shimmerEnd = chars.length + SHIMMER_WIDTH;
  let extraLines = 0;
  let tailLines: string[] = [];
  let totalLineCount = 0;
  let allLines: string[] = [];
  let expanded = false;
  let expandedLogLines = 0;
  let stopped = false;
  const startTime = Date.now();
  const timeoutSec = options?.timeoutSec;

  const colorEnabled = isColorEnabled();
  const frameColor = colorEnabled ? `\x1b[38;2;${theme.bright.r};${theme.bright.g};${theme.bright.b}m` : "";
  const dimCode = colorEnabled ? "\x1b[38;5;245m" : "";
  const resetCode = colorEnabled ? "\x1b[0m" : "";

  const writeFrame = () => {
    if (extraLines > 0) {
      process.stdout.write(`\x1b[${extraLines}A`);
    }
    const frame = FRAMES[frameIndex];
    const maxWidth = (process.stdout.columns || 80) - 6;
    let output = `\r\x1b[J${frameColor}${frame}${resetCode} ${shimmerText(message, shimmerPos, theme)}`;

    if (!expanded && tailLines.length > 0) {
      for (const line of tailLines) {
        const formatted = formatTailLine(line, maxWidth);
        output += `\n${dimCode}    ${formatted}${resetCode}`;
      }
    }

    if (timeoutSec != null) {
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      const visibleCount = expanded ? Math.min(allLines.length, getMaxExpandedLines()) : tailLines.length;
      const hiddenCount = Math.max(0, totalLineCount - visibleCount);
      const infoText = formatInfoLine(hiddenCount, elapsedSec, timeoutSec);

      let toggleHint = "";
      if (expanded) {
        toggleHint = "Ctrl+O to collapse";
      } else if (totalLineCount > TAIL_LINE_COUNT) {
        toggleHint = "Ctrl+O to expand";
      }
      const fullInfo = toggleHint ? `${infoText} — ${toggleHint}` : infoText;
      const formattedInfo = formatTailLine(fullInfo, maxWidth);
      output += `\n${dimCode}    ${formattedInfo}${resetCode}`;
    }

    process.stdout.write(output);
    extraLines = (expanded ? 0 : tailLines.length) + (timeoutSec != null ? 1 : 0);
  };

  const clearRenderedArea = () => {
    const linesToClear = expandedLogLines + extraLines;
    if (linesToClear > 0) {
      process.stdout.write(`\x1b[${linesToClear}A`);
    }
    process.stdout.write("\r\x1b[J");
  };

  const printExpandedWindow = () => {
    const maxLines = getMaxExpandedLines();
    const startIdx = Math.max(0, allLines.length - maxLines);
    const linesToPrint = allLines.slice(startIdx);
    const maxWidth = (process.stdout.columns || 80) - 6;
    for (const line of linesToPrint) {
      const formatted = formatTailLine(line, maxWidth);
      process.stdout.write(`${dimCode}    ${formatted}${resetCode}\n`);
    }
    expandedLogLines = linesToPrint.length;
  };

  const toggleExpand = () => {
    if (!expanded) {
      clearRenderedArea();
      extraLines = 0;
      expandedLogLines = 0;

      // Print bounded window of recent lines
      printExpandedWindow();
      expanded = true;
    } else {
      // Collapse: clear expanded lines + spinner area
      clearRenderedArea();
      extraLines = 0;
      expandedLogLines = 0;
      expanded = false;
    }
    writeFrame();
  };

  // Setup keyboard listener for Ctrl+O toggle
  let stdinHandler: ((data: Buffer) => void) | null = null;
  const setupKeyboard = () => {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    stdinHandler = (data: Buffer) => {
      if (data[0] === 0x03) {
        // Ctrl+C
        cleanupKeyboard();
        clearInterval(timer);
        process.stdout.write("\r\x1b[J\x1b[?25h");
        process.exit(130);
      }
      if (data[0] === 0x0f) {
        // Ctrl+O
        toggleExpand();
      }
    };
    process.stdin.on("data", stdinHandler);
  };

  const cleanupKeyboard = () => {
    if (stdinHandler) {
      process.stdin.removeListener("data", stdinHandler);
      stdinHandler = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };

  process.stdout.write("\x1b[?25l"); // Hide cursor
  writeFrame();
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % FRAMES.length;
    shimmerPos += SHIMMER_SPEED;
    if (shimmerPos > shimmerEnd + SHIMMER_PAUSE * SHIMMER_SPEED) {
      shimmerPos = -SHIMMER_WIDTH;
    }
    writeFrame();
  }, INTERVAL);
  setupKeyboard();

  const clearAndWrite = (text: string) => {
    cleanupKeyboard();
    clearRenderedArea();
    process.stdout.write(`${text}\n\x1b[?25h`); // Show cursor
  };

  return {
    stop(finalMessage?: string) {
      stopped = true;
      clearInterval(timer);
      clearAndWrite(finalMessage || `${icons.success()} ${message}`);
    },
    fail(errorMessage: string) {
      stopped = true;
      clearInterval(timer);
      clearAndWrite(`${icons.fail()} ${errorMessage}`);
    },
    updateTail(lines: string[], totalCount: number, newAllLines?: string[]) {
      if (stopped) return;
      tailLines = [...lines];
      totalLineCount = totalCount;
      if (newAllLines) allLines = newAllLines;

      if (expanded) {
        // Full redraw of bounded window
        clearRenderedArea();
        extraLines = 0;
        printExpandedWindow();
      }

      writeFrame();
    },
    isExpanded() {
      return expanded;
    },
  };
}
