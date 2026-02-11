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
 * Used by list.ts which builds complex multi-part strings with ANSI codes.
 */
export function rawCode(name: AnsiCodeName): string {
  return isColorEnabled() ? ANSI_CODES[name] : "";
}
