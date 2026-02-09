const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80; // ms

// Shimmer effect configuration
const SHIMMER_WIDTH = 6;
const SHIMMER_SPEED = 2; // characters per frame
const SHIMMER_PAUSE = 6; // extra dark frames between sweeps
const BASE_COLOR = { r: 120, g: 110, b: 170 };
const BRIGHT_COLOR = { r: 230, g: 225, b: 255 };

export type Spinner = {
  stop: (finalMessage?: string) => void;
  fail: (message: string) => void;
};

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

export function startSpinner(message: string): Spinner {
  let frameIndex = 0;
  let shimmerPos = -SHIMMER_WIDTH;
  const chars = [...message];
  const shimmerEnd = chars.length + SHIMMER_WIDTH;

  const write = (text: string) => {
    process.stdout.write(`\r\x1b[K${text}`);
  };

  write(`${FRAMES[0]} ${shimmerText(message, shimmerPos)}`);
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % FRAMES.length;
    shimmerPos += SHIMMER_SPEED;
    if (shimmerPos > shimmerEnd + SHIMMER_PAUSE * SHIMMER_SPEED) {
      shimmerPos = -SHIMMER_WIDTH;
    }
    write(`${FRAMES[frameIndex]} ${shimmerText(message, shimmerPos)}`);
  }, INTERVAL);

  return {
    stop(finalMessage?: string) {
      clearInterval(timer);
      if (finalMessage) {
        write(`${finalMessage}\n`);
      } else {
        write(`✓ ${message}\n`);
      }
    },
    fail(errorMessage: string) {
      clearInterval(timer);
      write(`✗ ${errorMessage}\n`);
    },
  };
}
