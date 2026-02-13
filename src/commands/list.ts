import { relative } from "node:path";

import { fetchAndPrune, getAheadBehind, getLastCommit, getWorktreeStatuses, listWorktrees } from "../core/git.ts";
import { determineSessionStatus, formatElapsed, readAllSessions } from "../core/session.ts";
import { listWeztermPanes } from "../external/wezterm.ts";
import type {
  AheadBehind,
  ListArgs,
  ListDeps,
  ListResult,
  SessionState,
  WorktreeListEntry,
  WorktreeStatus,
} from "../types.ts";
import { rawCode } from "../ui/color.ts";
import { icons } from "../ui/icons.ts";
import { startSpinner } from "../ui/spinner.ts";

const defaultDeps: ListDeps = {
  fetchAndPrune,
  listWorktrees,
  getWorktreeStatuses,
  getLastCommit,
  getAheadBehind,
  startSpinner,
  readAllSessions,
  listWeztermPanes,
};

type StatusBadge = {
  icon: string;
  label: string;
  color: string;
};

export function getStatusBadge(status: WorktreeStatus): StatusBadge {
  if (status.worktree.isMain) {
    return { icon: icons.bullet(), label: "Main", color: rawCode("blue") };
  }
  if (status.worktree.isLocked) {
    return { icon: icons.lock(), label: "Locked", color: rawCode("magenta") };
  }
  if (status.branchMerged) {
    return { icon: icons.success(), label: "Merged", color: rawCode("green") };
  }
  if (status.worktree.isDirty) {
    return { icon: icons.warning(), label: "Dirty", color: rawCode("yellow") };
  }
  return { icon: icons.active(), label: "Active", color: rawCode("cyan") };
}

export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return "just now";
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  }

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
  }

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) {
    return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  }

  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) {
    return `${diffWeek} week${diffWeek === 1 ? "" : "s"} ago`;
  }

  if (diffDay < 365) {
    const diffMonth = Math.floor(diffDay / 30);
    return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`;
  }

  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear} year${diffYear === 1 ? "" : "s"} ago`;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

export function shortenPath(fullPath: string, repoRoot: string): string {
  return relative(repoRoot, fullPath);
}

export function formatAheadBehind(ab: AheadBehind | null): string {
  if (!ab) return "";
  const parts: string[] = [];
  if (ab.ahead > 0) parts.push(`↑${ab.ahead}`);
  if (ab.behind > 0) parts.push(`↓${ab.behind}`);
  return parts.join(" ");
}

export function formatSessionState(session: SessionState): string {
  const elapsed = formatElapsed(session.elapsedMs);
  const panePart = session.paneId != null ? `  pane #${session.paneId}` : "";
  const g = rawCode("green");
  const r = rawCode("reset");
  const d = rawCode("dim");
  if (session.status === "running") {
    return `${g}${icons.active()}${r} ${g}Running${r} ${d}(${elapsed})${r}${panePart}`;
  }
  return `${g}${icons.success()}${r} Done ${d}(${elapsed})${r}${panePart}`;
}

export function formatWorktreeEntry(entry: WorktreeListEntry, repoRoot: string, verbose: boolean): string[] {
  const { worktree, status, commit, aheadBehind, session } = entry;
  const badge = getStatusBadge(status);
  const branch = worktree.branch || "(detached)";
  const r = rawCode("reset");
  const b = rawCode("bold");
  const d = rawCode("dim");

  // Line 1: icon + branch (bold) + badge (colored) + ahead/behind + session state
  const abStr = formatAheadBehind(aheadBehind);
  const badgePart = `${badge.color}${badge.label}${r}`;
  const abPart = abStr ? `  ${abStr}` : "";
  const sessionPart = session ? `       ${formatSessionState(session)}` : "";
  const line1 = `  ${badge.color}${badge.icon}${r} ${b}${branch}${r}  ${badgePart}${abPart}${sessionPart}`;

  // Line 2: commit hash (dim) + message + relative time (dim)
  let line2: string;
  if (commit) {
    const hash = verbose ? commit.hash : commit.hash.slice(0, 7);
    const msg = verbose ? commit.message : truncate(commit.message, 50);
    const timeStr = formatRelativeTime(commit.date);
    line2 = `    ${d}${hash}${r}  ${msg}  ${d}${timeStr}${r}`;
  } else {
    line2 = `    ${d}(no commits)${r}`;
  }

  // Line 3: path (dim)
  const pathStr = verbose ? worktree.path : shortenPath(worktree.path, repoRoot);
  const line3 = `    ${d}${pathStr}${r}`;

  return [line1, line2, line3];
}

export function formatSummary(entries: WorktreeListEntry[]): string {
  const total = entries.length;
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    const badge = getStatusBadge(entry.status);
    const label = badge.label.toLowerCase();
    counts[label] = (counts[label] || 0) + 1;
  }

  const parts = Object.entries(counts).map(([label, count]) => `${count} ${label}`);
  return `Summary: ${total} worktree${total === 1 ? "" : "s"} (${parts.join(", ")})`;
}

export async function executeList(args: ListArgs, deps: ListDeps = defaultDeps): Promise<ListResult> {
  const result: ListResult = { entries: [] };

  const spinner = args.json ? null : deps.startSpinner("Fetching worktree information...");
  let succeeded = false;

  try {
    // Fetch and prune (graceful failure)
    try {
      await deps.fetchAndPrune();
    } catch {
      // Silently continue
    }

    const { worktrees, mainBranch } = await deps.listWorktrees();

    if (worktrees.length > 0) {
      const statuses = await deps.getWorktreeStatuses(worktrees, mainBranch);

      // Fetch panes and sessions by default (skip with -no-status)
      const panes = args.noStatus ? null : await deps.listWeztermPanes();
      const sessions = args.noStatus ? {} : await deps.readAllSessions();

      // Build entries (parallelize per-worktree git operations)
      result.entries = await Promise.all(
        statuses.map(async (status) => {
          const [commit, aheadBehind] = await Promise.all([
            deps.getLastCommit(status.worktree.path),
            status.worktree.branch && !status.worktree.isMain
              ? deps.getAheadBehind(status.worktree.branch, mainBranch)
              : Promise.resolve(null),
          ]);

          let session: SessionState | undefined;
          if (!args.noStatus) {
            const sessionInfo = sessions[status.worktree.path];
            if (sessionInfo) {
              session = determineSessionStatus(sessionInfo, panes);
            }
          }

          return { worktree: status.worktree, status, commit, aheadBehind, session };
        }),
      );
    }

    succeeded = true;
  } finally {
    if (succeeded) {
      spinner?.stop();
    } else {
      spinner?.fail("Failed to fetch worktree information");
    }
  }

  // Empty result
  if (result.entries.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({ worktrees: [] }, null, 2));
    } else {
      console.log("No worktrees found.");
    }
    return result;
  }

  // JSON mode
  if (args.json) {
    const jsonOutput = {
      worktrees: result.entries.map((e) => ({
        path: e.worktree.path,
        branch: e.worktree.branch,
        isMain: e.worktree.isMain,
        isLocked: e.worktree.isLocked,
        isDirty: e.worktree.isDirty,
        status: getStatusBadge(e.status).label,
        commit: e.commit ? { hash: e.commit.hash, message: e.commit.message, date: e.commit.date.toISOString() } : null,
        aheadBehind: e.aheadBehind,
        ...(e.session && {
          session: {
            status: e.session.status,
            elapsedMs: e.session.elapsedMs,
            mode: e.session.mode,
            paneId: e.session.paneId,
          },
        }),
      })),
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return result;
  }

  // Rich display
  console.log(`\n${rawCode("bold")}Worktrees (${result.entries.length})${rawCode("reset")}\n`);

  // Derive repoRoot from main worktree path or first worktree
  const mainEntry = result.entries.find((e) => e.worktree.isMain);
  const repoRoot = mainEntry?.worktree.path ?? result.entries[0]?.worktree.path ?? ".";

  for (const entry of result.entries) {
    const lines = formatWorktreeEntry(entry, repoRoot, args.verbose);
    for (const line of lines) {
      console.log(line);
    }
    console.log("");
  }

  console.log(formatSummary(result.entries));

  return result;
}
