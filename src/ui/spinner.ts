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

export function createTailUpdater(spinner: Spinner): (line: string) => void {
  const lines: string[] = [];
  return (line: string) => {
    lines.push(line);
    if (lines.length > TAIL_LINE_COUNT) lines.shift();
    spinner.updateTail(lines);
  };
}

export function startSpinner(message: string): Spinner {
  let frameIndex = 0;
  let shimmerPos = -SHIMMER_WIDTH;
  const chars = [...message];
  const shimmerEnd = chars.length + SHIMMER_WIDTH;
  let extraLines = 0;
  let tailLines: string[] = [];

  const writeFrame = () => {
    if (extraLines > 0) {
      process.stdout.write(`\x1b[${extraLines}A`);
    }
    const frame = FRAMES[frameIndex];
    let output = `\r\x1b[J${frame} ${shimmerText(message, shimmerPos)}`;
    if (tailLines.length > 0) {
      const maxWidth = (process.stdout.columns || 80) - 6;
      for (const line of tailLines) {
        const formatted = formatTailLine(line, maxWidth);
        output += `\n\x1b[38;5;245m    ${formatted}\x1b[0m`;
      }
    }
    process.stdout.write(output);
    extraLines = tailLines.length;
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

  const clearAndWrite = (text: string) => {
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
    updateTail(lines: string[]) {
      tailLines = [...lines];
      writeFrame();
    },
  };
}
