import { DependencyError, UsageError } from "../core/errors.ts";
import type { BackendType, CreatedPane, PaneOptions, TerminalBackend } from "../types/index.ts";
import * as herdr from "./herdr.ts";
import * as tmux from "./tmux.ts";
import * as wezterm from "./wezterm.ts";

export const BACKEND_ENV_VAR = "CLAUDE_WORKTREE_BACKEND";
export const BACKEND_TYPES: readonly BackendType[] = ["wezterm", "tmux", "herdr"];

export function isBackendType(value: string): value is BackendType {
  return (BACKEND_TYPES as readonly string[]).includes(value);
}

/**
 * Detect which terminal backend is available based on environment.
 *
 * Priority:
 * 1. HERDR_ENV=1 → herdr (checked first: herdr panes inherit WEZTERM_PANE/TMUX from the herdr server process)
 * 2. WEZTERM_PANE → wezterm
 * 3. TMUX → tmux
 * 4. null
 */
export function detectBackend(): BackendType | null {
  if (herdr.isRunningInsideHerdr()) {
    return "herdr";
  }
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
    createPane: async (options?: PaneOptions) => ({ paneId: await wezterm.createPane(options) }),
    sendCommand: (paneId: string, command: string) => wezterm.sendCommand(paneId, command),
    closePane: (pane: CreatedPane) => wezterm.closePane(pane.paneId),
  };
}

export function createTmuxBackend(): TerminalBackend {
  return {
    name: "tmux",
    createPane: async (options?: PaneOptions) => ({ paneId: await tmux.createPane(options) }),
    sendCommand: (paneId: string, command: string) => tmux.sendCommand(paneId, command),
    closePane: (pane: CreatedPane) => tmux.closePane(pane.paneId),
  };
}

export function createHerdrBackend(): TerminalBackend {
  return {
    name: "herdr",
    createPane: (options?: PaneOptions) => herdr.createPane(options),
    sendCommand: (paneId: string, command: string) => herdr.sendCommand(paneId, command),
    closePane: (pane: CreatedPane) => herdr.closeCreatedPane(pane),
  };
}

/**
 * Create a TerminalBackend for the given backend type.
 */
export function createBackend(type: BackendType): TerminalBackend {
  switch (type) {
    case "wezterm":
      return createWeztermBackend();
    case "tmux":
      return createTmuxBackend();
    case "herdr":
      return createHerdrBackend();
  }
}

/**
 * Detect and validate that a pane backend is available.
 * Throws DependencyError if no backend is available.
 * Returns the validated TerminalBackend.
 */
export async function ensurePaneBackendAvailable(usageHint: string): Promise<TerminalBackend> {
  const commonFooter = `\n\nOr run without -pane to use the current terminal:\n  ${usageHint}`;

  const forced = process.env[BACKEND_ENV_VAR]?.trim();
  if (forced) {
    if (!isBackendType(forced)) {
      throw new UsageError(`Invalid ${BACKEND_ENV_VAR} value "${forced}". Expected one of: wezterm, tmux, herdr.`);
    }

    if (forced === "wezterm") {
      if (!wezterm.isRunningInsideWezterm()) {
        throw new DependencyError(
          `CLAUDE_WORKTREE_BACKEND=wezterm requires running inside WezTerm, but the current terminal is ${process.env.TERM_PROGRAM || "unknown terminal"}.` +
            commonFooter,
        );
      }
    } else if (forced === "tmux") {
      if (!(await tmux.checkTmuxAvailable())) {
        throw new DependencyError(
          `CLAUDE_WORKTREE_BACKEND=tmux requires tmux, but it is not installed.${commonFooter}`,
        );
      }
    } else if (forced === "herdr") {
      if (!(await herdr.checkHerdrAvailable())) {
        throw new DependencyError(
          `CLAUDE_WORKTREE_BACKEND=herdr requires the herdr CLI, but it is not installed.${commonFooter}`,
        );
      }
      if (!(await herdr.isHerdrServerRunning())) {
        throw new DependencyError(
          `CLAUDE_WORKTREE_BACKEND=herdr requires a running herdr server. Run \`herdr\` to start one, then retry.${commonFooter}`,
        );
      }
    }

    return createBackend(forced);
  }

  const detected = detectBackend();
  if (detected) {
    return createBackend(detected);
  }

  // No backend detected from environment — check what's installed
  const [herdrInstalled, tmuxInstalled, weztermInstalled] = await Promise.all([
    herdr.checkHerdrAvailable(),
    tmux.checkTmuxAvailable(),
    wezterm.checkWeztermAvailable(),
  ]);

  if (herdrInstalled && (await herdr.isHerdrServerRunning())) {
    // herdr can open a new workspace from any terminal while its server is running
    return createHerdrBackend();
  }

  if (tmuxInstalled) {
    // tmux can create detached sessions even outside tmux
    return createTmuxBackend();
  }

  if (!weztermInstalled && !herdrInstalled) {
    const installHint =
      process.platform === "darwin"
        ? "  brew install --cask wezterm    # WezTerm\n  brew install tmux              # tmux\n  brew install herdr             # herdr"
        : process.platform === "linux"
          ? "  https://wezfurlong.org/wezterm/install/linux.html    # WezTerm\n  sudo apt install tmux                                 # tmux\n  https://herdr.dev                                     # herdr"
          : "  https://wezfurlong.org/wezterm/installation.html    # WezTerm\n  https://github.com/tmux/tmux/wiki/Installing          # tmux\n  https://herdr.dev                                   # herdr";

    throw new DependencyError(
      "The -pane option requires WezTerm, tmux or herdr.\n\n" +
        `Install one of:\n${installHint}\n\n` +
        "Or run without -pane to use the current terminal:\n" +
        `  ${usageHint}`,
    );
  }

  // WezTerm and/or herdr installed but not usable right now
  const currentTerminal = process.env.TERM_PROGRAM || "unknown terminal";

  let message = `The -pane option requires running inside WezTerm, tmux or herdr, but the current terminal is ${currentTerminal}.\n\n`;

  if (weztermInstalled) {
    message += "WezTerm is installed. Start a session in WezTerm first.\n\n";
  }

  if (herdrInstalled) {
    message += "herdr is installed but no server is running. Run `herdr` to start one, then retry.\n\n";
  }

  message +=
    "Or install tmux to use -pane from any terminal:\n" +
    `  ${process.platform === "darwin" ? "brew install tmux" : process.platform === "linux" ? "sudo apt install tmux    # Debian/Ubuntu\n  sudo dnf install tmux    # Fedora/RHEL" : "https://github.com/tmux/tmux/wiki/Installing"}\n\n` +
    "Or run without -pane to use the current terminal:\n" +
    `  ${usageHint}`;

  throw new DependencyError(message);
}
