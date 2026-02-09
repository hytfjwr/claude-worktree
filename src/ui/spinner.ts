import type { Spinner } from "../types";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80; // ms

// Shimmer effect configuration
const SHIMMER_WIDTH = 6;
const SHIMMER_SPEED = 2; // characters per frame
const SHIMMER_PAUSE = 6; // extra dark frames between sweeps
const BASE_COLOR = { r: 120, g: 110, b: 170 };
const BRIGHT_COLOR = { r: 230, g: 225, b: 255 };

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

export function shimmerText(text: string, shimmerPos: number): string {
  const chars = [...text];
  let result = "";
  for (let i = 0; i < chars.length; i++) {
    const distance = Math.abs(i - shimmerPos);
    const t = Math.max(0, 1 - distance / SHIMMER_WIDTH);
    const st = smoothstep(t);
    const r = lerp(BASE_COLOR.r, BRIGHT_COLOR.r, st);
    const g = lerp(BASE_COLOR.g, BRIGHT_COLOR.g, st);
    const b = lerp(BASE_COLOR.b, BRIGHT_COLOR.b, st);
    result += `\x1b[38;2;${r};${g};${b}m${chars[i]}`;
  }
  result += "\x1b[0m";
  return result;
}

const TAIL_LINE_COUNT = 3;
const MAX_ALL_LINES = 10000;

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

export function createTailUpdater(spinner: Spinner): (line: string) => void {
  const tailLines: string[] = [];
  const allLines: string[] = [];
  let totalCount = 0;
  return (line: string) => {
    if (allLines.length < MAX_ALL_LINES) {
      allLines.push(line);
    }
    tailLines.push(line);
    totalCount++;
    if (tailLines.length > TAIL_LINE_COUNT) tailLines.shift();
    spinner.updateTail(tailLines, totalCount, allLines);
  };
}

export function startSpinner(message: string, options?: { timeoutSec?: number }): Spinner {
  let frameIndex = 0;
  let shimmerPos = -SHIMMER_WIDTH;
  const chars = [...message];
  const shimmerEnd = chars.length + SHIMMER_WIDTH;
  let extraLines = 0;
  let tailLines: string[] = [];
  let totalLineCount = 0;
  let allLines: string[] = [];
  let expanded = false;
  let expandPrintedCount = 0;
  let expandedLogLines = 0;
  const startTime = Date.now();
  const timeoutSec = options?.timeoutSec;

  const writeFrame = () => {
    if (extraLines > 0) {
      process.stdout.write(`\x1b[${extraLines}A`);
    }
    const frame = FRAMES[frameIndex];
    const maxWidth = (process.stdout.columns || 80) - 6;
    let output = `\r\x1b[J${frame} ${shimmerText(message, shimmerPos)}`;

    if (!expanded && tailLines.length > 0) {
      for (const line of tailLines) {
        const formatted = formatTailLine(line, maxWidth);
        output += `\n\x1b[38;5;245m    ${formatted}\x1b[0m`;
      }
    }

    if (timeoutSec != null) {
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      const hiddenCount = expanded ? 0 : Math.max(0, totalLineCount - tailLines.length);
      const infoText = formatInfoLine(hiddenCount, elapsedSec, timeoutSec);

      let toggleHint = "";
      if (expanded) {
        toggleHint = "Ctrl+O to collapse";
      } else if (totalLineCount > TAIL_LINE_COUNT) {
        toggleHint = "Ctrl+O to expand";
      }
      const fullInfo = toggleHint ? `${infoText} — ${toggleHint}` : infoText;
      const formattedInfo = formatTailLine(fullInfo, maxWidth);
      output += `\n\x1b[38;5;245m    ${formattedInfo}\x1b[0m`;
    }

    process.stdout.write(output);
    extraLines = (expanded ? 0 : tailLines.length) + (timeoutSec != null ? 1 : 0);
  };

  const printAllLines = () => {
    const maxWidth = (process.stdout.columns || 80) - 6;
    for (let i = expandPrintedCount; i < allLines.length; i++) {
      const formatted = formatTailLine(allLines[i], maxWidth);
      process.stdout.write(`\x1b[38;5;245m    ${formatted}\x1b[0m\n`);
      expandedLogLines++;
    }
    expandPrintedCount = allLines.length;
  };

  const toggleExpand = () => {
    if (!expanded) {
      // Clear current spinner area
      if (extraLines > 0) {
        process.stdout.write(`\x1b[${extraLines}A`);
      }
      process.stdout.write("\r\x1b[J");
      extraLines = 0;
      expandedLogLines = 0;

      // Print lines accumulated since last expand
      printAllLines();
      expanded = true;
    } else {
      // Collapse: clear expanded lines + spinner area
      const totalClearLines = expandedLogLines + extraLines;
      if (totalClearLines > 0) {
        process.stdout.write(`\x1b[${totalClearLines}A`);
      }
      process.stdout.write("\r\x1b[J");
      extraLines = 0;
      expandedLogLines = 0;
      expandPrintedCount = 0;
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
    if (extraLines > 0) {
      process.stdout.write(`\x1b[${extraLines}A`);
    }
    process.stdout.write(`\r\x1b[J${text}\n\x1b[?25h`); // Show cursor
  };

  return {
    stop(finalMessage?: string) {
      clearInterval(timer);
      clearAndWrite(finalMessage || `✓ ${message}`);
    },
    fail(errorMessage: string) {
      clearInterval(timer);
      clearAndWrite(`✗ ${errorMessage}`);
    },
    updateTail(lines: string[], totalCount: number, newAllLines?: string[]) {
      tailLines = [...lines];
      totalLineCount = totalCount;
      if (newAllLines) allLines = newAllLines;

      if (expanded && allLines.length > expandPrintedCount) {
        // Print new lines above the spinner
        if (extraLines > 0) {
          process.stdout.write(`\x1b[${extraLines}A`);
        }
        process.stdout.write("\r\x1b[J");
        extraLines = 0;
        printAllLines();
      }

      writeFrame();
    },
  };
}
