import { DependencyError } from "../core/errors.ts";
import type { PaneOptions, TerminalBackend } from "../types/index.ts";
import * as tmux from "./tmux.ts";
import * as wezterm from "./wezterm.ts";

/**
 * Detect which terminal backend is available based on environment.
 *
 * Priority:
 * 1. WEZTERM_PANE is set → WezTerm backend
 * 2. TMUX is set → tmux backend
 * 3. Neither → null
 */
export function detectBackend(): "wezterm" | "tmux" | null {
  if (wezterm.isRunningInsideWezterm()) {
    return "wezterm";
  }
  if (tmux.isRunningInsideTmux()) {
    return "tmux";
  }
  return null;
}

export function createWeztermBackend(): TerminalBackend {
  return {
    name: "wezterm",
    createPane: (options?: PaneOptions) => wezterm.createPane(options),
    sendCommand: (paneId: string, command: string) => wezterm.sendCommand(paneId, command),
  };
}

export function createTmuxBackend(): TerminalBackend {
  return {
    name: "tmux",
    createPane: (options?: PaneOptions) => tmux.createPane(options),
    sendCommand: (paneId: string, command: string) => tmux.sendCommand(paneId, command),
  };
}

/**
 * Create a TerminalBackend for the given backend type.
 */
export function createBackend(type: "wezterm" | "tmux"): TerminalBackend {
  return type === "wezterm" ? createWeztermBackend() : createTmuxBackend();
}

/**
 * Detect and validate that a pane backend is available.
 * Throws DependencyError if no backend is available.
 * Returns the validated TerminalBackend.
 */
export async function ensurePaneBackendAvailable(usageHint: string): Promise<TerminalBackend> {
  const detected = detectBackend();

  if (detected) {
    return createBackend(detected);
  }

  // Neither WezTerm nor tmux detected — check what's installed
  const [weztermInstalled, tmuxInstalled] = await Promise.all([
    wezterm.checkWeztermAvailable(),
    tmux.checkTmuxAvailable(),
  ]);

  if (tmuxInstalled) {
    // tmux can create detached sessions even outside tmux
    return createTmuxBackend();
  }

  if (!weztermInstalled) {
    const installHint =
      process.platform === "darwin"
        ? "  brew install --cask wezterm    # WezTerm\n  brew install tmux              # tmux"
        : process.platform === "linux"
          ? "  https://wezfurlong.org/wezterm/install/linux.html    # WezTerm\n  sudo apt install tmux                                 # tmux"
          : "  https://wezfurlong.org/wezterm/installation.html    # WezTerm\n  https://github.com/tmux/tmux/wiki/Installing          # tmux";

    throw new DependencyError(
      "The -pane option requires WezTerm or tmux.\n\n" +
        `Install one of:\n${installHint}\n\n` +
        "Or run without -pane to use the current terminal:\n" +
        `  ${usageHint}`,
    );
  }

  // Only WezTerm installed but not inside WezTerm
  const currentTerminal = process.env.TERM_PROGRAM || "unknown terminal";

  throw new DependencyError(
    `The -pane option requires running inside WezTerm or tmux, but the current terminal is ${currentTerminal}.\n\n` +
      "WezTerm is installed. Start a session in WezTerm first.\n\n" +
      "Or install tmux to use -pane from any terminal:\n" +
      `  ${process.platform === "darwin" ? "brew install tmux" : process.platform === "linux" ? "sudo apt install tmux    # Debian/Ubuntu\n  sudo dnf install tmux    # Fedora/RHEL" : "https://github.com/tmux/tmux/wiki/Installing"}\n\n` +
      "Or run without -pane to use the current terminal:\n" +
      `  ${usageHint}`,
  );
}
