import { stringWidth, truncateToWidth } from "../core/width.ts";
import type { ListArgs, ListDeps, ListWatchIo, WorktreeListEntry } from "../types/index.ts";
import { bold, dim, yellow } from "../ui/color.ts";
import { collectListEntries, defaultListDeps, formatSummary, formatWorktreeEntry, resolveRepoRoot } from "./list.ts";

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const CLEAR_SCREEN = "\x1b[2J";
const CLEAR_LINE_END = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";

const DEFAULT_INTERVAL_SECONDS = 2;
/** Header (title + blank) lines that never scroll away. */
const HEADER_HEIGHT = 2;
/** Each entry renders as 3 lines plus a blank separator. */
const ENTRY_BLOCK_HEIGHT = 4;
const FOOTER_HINT = "  r refresh   q/Esc/Ctrl+C quit";

/** Local wall-clock time as HH:MM:SS. */
export function formatClockTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export type WatchKeyAction = "quit" | "interrupt" | "refresh" | "unknown";

/**
 * Local key parser: the interactive selector's parser is being reworked on
 * another branch, so this view keeps its own tiny copy.
 */
export function parseWatchKey(data: Buffer): WatchKeyAction {
  if (data.length === 1) {
    const byte = data[0];
    if (byte === 0x03) return "interrupt"; // Ctrl+C
    if (byte === 0x1b) return "quit"; // Esc — a bare byte, not an escape sequence
    if (byte === 0x71) return "quit"; // q
    if (byte === 0x72) return "refresh"; // r
  }
  return "unknown";
}

export type WatchFrameMeta = {
  /** Time of the last successful snapshot; null until the first one lands. */
  updatedAt: Date | null;
  refreshing: boolean;
  /** Message from the most recent failed refresh, shown above the footer. */
  error?: string;
};

export function renderWatchFrame(
  entries: WorktreeListEntry[],
  repoRoot: string,
  args: ListArgs,
  rows: number,
  cols: number,
  meta: WatchFrameMeta,
): string {
  const header =
    meta.updatedAt === null
      ? `${bold("Worktrees")}  ${dim("loading…")}`
      : `${bold(`Worktrees (${entries.length})`)}  ${dim(`updated ${formatClockTime(meta.updatedAt)}`)}${meta.refreshing ? dim("  refreshing…") : ""}`;

  const footer = dim(FOOTER_HINT);
  const errorLine = meta.error ? yellow(`  Update failed: ${meta.error}`) : undefined;

  let body: string[];
  if (meta.updatedAt === null) {
    body = [dim("  Loading worktrees…")];
  } else if (entries.length === 0) {
    body = [dim("  No worktrees found.")];
  } else {
    const footerHeight = 1 + (meta.error ? 1 : 0);
    // Header, footer and the summary line are always drawn; the rest is for entries.
    const budget = Math.max(0, rows - HEADER_HEIGHT - footerHeight - 1);
    let shown = Math.min(entries.length, Math.floor(budget / ENTRY_BLOCK_HEIGHT));
    if (shown < entries.length) {
      // One line goes to the "and N more" notice.
      shown = Math.max(0, Math.floor((budget - 1) / ENTRY_BLOCK_HEIGHT));
    }
    const omitted = entries.length - shown;

    body = [];
    for (const entry of entries.slice(0, shown)) {
      body.push(...formatWorktreeEntry(entry, repoRoot, args.verbose), "");
    }
    if (omitted > 0) {
      body.push(dim(`  … and ${omitted} more`));
    }
    body.push(formatSummary(entries));
  }

  const lines = [header, "", ...body, ...(errorLine ? [errorLine] : []), footer];

  // truncateToWidth strips ANSI unconditionally, so only over-wide lines pay for
  // it by losing their color.
  const fit = (line: string) => (stringWidth(line) <= cols ? line : truncateToWidth(line, cols));
  return lines.map(fit).join("\n");
}

/**
 * Raw mode leaves the cursor column where it was, so rows are joined with CR+LF.
 * Each line clears to its end and CLEAR_BELOW wipes rows left over from a taller
 * previous frame, which avoids a full-screen clear (and its flicker) per redraw.
 */
function toAnsiFrame(frame: string, clearFirst: boolean): string {
  const body = frame
    .split("\n")
    .map((line) => `${line}${CLEAR_LINE_END}`)
    .join("\r\n");
  return `${clearFirst ? CLEAR_SCREEN : ""}${CURSOR_HOME}${body}${CLEAR_BELOW}`;
}

export function createDefaultWatchIo(): ListWatchIo {
  return {
    write: (chunk) => {
      process.stdout.write(chunk);
    },
    // A pty can report 0 for either dimension, which would collapse every line to
    // an ellipsis, so zero falls back to the default too.
    rows: () => process.stdout.rows || 24,
    columns: () => process.stdout.columns || 80,
    now: () => new Date(),
    setRawMode: (enabled) => {
      process.stdin.setRawMode?.(enabled);
    },
    onKey: (listener) => {
      process.stdin.resume();
      process.stdin.on("data", listener);
      return () => {
        process.stdin.removeListener("data", listener);
        process.stdin.pause();
      };
    },
    onResize: (listener) => {
      process.on("SIGWINCH", listener);
      return () => {
        process.removeListener("SIGWINCH", listener);
      };
    },
    onExit: (listener) => {
      process.on("exit", listener);
      return () => {
        process.removeListener("exit", listener);
      };
    },
    setInterval: (callback, ms) => {
      const handle = setInterval(callback, ms);
      return () => {
        clearInterval(handle);
      };
    },
    exit: (code) => {
      process.exit(code);
    },
  };
}

export function executeListWatch(
  args: ListArgs,
  deps: ListDeps = defaultListDeps,
  io: ListWatchIo = createDefaultWatchIo(),
): Promise<void> {
  return new Promise<void>((resolve) => {
    const intervalMs = (args.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000;

    let entries: WorktreeListEntry[] = [];
    let repoRoot = ".";
    let updatedAt: Date | null = null;
    let error: string | undefined;
    let refreshing = false;
    let fetchDone = false;
    let lastFrame: string | null = null;
    let clearNext = true;
    let finished = false;

    const draw = () => {
      // The terminal is already restored after finish(): a late refresh must not
      // draw into the normal screen buffer.
      if (finished) return;
      const frame = renderWatchFrame(entries, repoRoot, args, io.rows(), io.columns(), {
        updatedAt,
        refreshing,
        error,
      });
      // Skip the write when nothing changed: no flicker, no wasted output.
      if (frame === lastFrame && !clearNext) return;
      lastFrame = frame;
      io.write(toAnsiFrame(frame, clearNext));
      clearNext = false;
    };

    const refresh = async (showRefreshing: boolean) => {
      // A refresh slower than the interval must not stack up ticks.
      if (refreshing) return;
      refreshing = true;
      // -fetch hits the network, so it applies to the first refresh only.
      const shouldFetch = Boolean(args.fetch) && !fetchDone;
      fetchDone = true;
      if (showRefreshing) {
        draw();
      }
      try {
        const next = await collectListEntries({ ...args, fetch: shouldFetch }, deps);
        entries = next;
        repoRoot = resolveRepoRoot(next);
        updatedAt = io.now();
        error = undefined;
      } catch (e) {
        // A transient git failure must not kill the loop: show it and retry next tick.
        error = e instanceof Error ? e.message : String(e);
      } finally {
        refreshing = false;
        draw();
      }
    };

    let cancelInterval: () => void = () => {};

    const cleanup = () => {
      cancelInterval();
      unsubscribeKey();
      unsubscribeResize();
      try {
        io.setRawMode(false);
      } catch {}
      io.write(`${SHOW_CURSOR}${LEAVE_ALT_SCREEN}`);
      unsubscribeExit();
    };

    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (code !== 0) {
        io.exit(code);
      }
      resolve();
    };

    // Abnormal exit: cleanup never ran, so restore the terminal here.
    const exitHandler = () => {
      if (finished) return;
      try {
        io.setRawMode(false);
      } catch {}
      io.write(`${SHOW_CURSOR}${LEAVE_ALT_SCREEN}`);
    };

    const onKeyData = (data: Buffer) => {
      const action = parseWatchKey(data);
      if (action === "interrupt") {
        finish(130);
        return;
      }
      if (action === "quit") {
        finish(0);
        return;
      }
      if (action === "refresh") {
        void refresh(true);
      }
    };

    io.write(`${ENTER_ALT_SCREEN}${HIDE_CURSOR}`);
    io.setRawMode(true);
    const unsubscribeKey = io.onKey(onKeyData);
    const unsubscribeResize = io.onResize(() => {
      // Dimensions changed: force a full repaint.
      clearNext = true;
      draw();
    });
    const unsubscribeExit = io.onExit(exitHandler);
    cancelInterval = io.setInterval(() => {
      void refresh(false);
    }, intervalMs);
    draw();
    void refresh(true);
  });
}
