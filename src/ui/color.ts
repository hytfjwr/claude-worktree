type AnsiCodeName = "reset" | "bold" | "dim" | "green" | "yellow" | "blue" | "magenta" | "cyan";

const ANSI_CODES: Record<AnsiCodeName, string> = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[38;5;245m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

let colorCache: boolean | null = null;

export function shouldUseColor(): boolean {
  // NO_COLOR standard: any non-empty value disables color
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") {
    return false;
  }
  // Non-TTY contexts (piped output) disable color
  if (!process.stdout.isTTY) {
    return false;
  }
  return true;
}

export function isColorEnabled(): boolean {
  if (colorCache == null) {
    colorCache = shouldUseColor();
  }
  return colorCache;
}

/** Reset cached color state — for testing only. */
export function _resetColorCache(): void {
  colorCache = null;
}

/**
 * Returns the ANSI code string for the given name, or "" when color is disabled.
 * Useful when building complex multi-part strings with raw ANSI codes.
 */
export function rawCode(name: AnsiCodeName): string {
  return isColorEnabled() ? ANSI_CODES[name] : "";
}

// ---------------------------------------------------------------------------
// Color wrapper functions — wrap text with ANSI codes and auto-reset.
// ---------------------------------------------------------------------------

export function bold(text: string): string {
  return isColorEnabled() ? `${ANSI_CODES.bold}${text}${ANSI_CODES.reset}` : text;
}

export function dim(text: string): string {
  return isColorEnabled() ? `${ANSI_CODES.dim}${text}${ANSI_CODES.reset}` : text;
}

export function green(text: string): string {
  return isColorEnabled() ? `${ANSI_CODES.green}${text}${ANSI_CODES.reset}` : text;
}

export function yellow(text: string): string {
  return isColorEnabled() ? `${ANSI_CODES.yellow}${text}${ANSI_CODES.reset}` : text;
}

export function blue(text: string): string {
  return isColorEnabled() ? `${ANSI_CODES.blue}${text}${ANSI_CODES.reset}` : text;
}

export function magenta(text: string): string {
  return isColorEnabled() ? `${ANSI_CODES.magenta}${text}${ANSI_CODES.reset}` : text;
}

export function cyan(text: string): string {
  return isColorEnabled() ? `${ANSI_CODES.cyan}${text}${ANSI_CODES.reset}` : text;
}

/**
 * Wraps text with a raw ANSI code string and auto-resets.
 * Useful for dynamic colors like StatusBadge.color.
 */
export function colorize(code: string, text: string): string {
  if (!code || !isColorEnabled()) return text;
  return `${code}${text}${ANSI_CODES.reset}`;
}

/**
 * Applies multiple named styles to text at once.
 * Useful when you need both bold and a color without nesting issues.
 */
export function styles(text: string, ...names: AnsiCodeName[]): string {
  if (!isColorEnabled()) return text;
  const codes = names.map((n) => ANSI_CODES[n]).join("");
  return `${codes}${text}${ANSI_CODES.reset}`;
}
