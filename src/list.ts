import { relative } from "path";
import {
  fetchAndPrune,
  listWorktrees,
  getWorktreeStatuses,
  getLastCommit,
  getAheadBehind,
  getMainBranch,
  type WorktreeInfo,
  type WorktreeStatus,
  type CommitInfo,
  type AheadBehind,
} from "./git";
import { startSpinner, type Spinner } from "./spinner";

export type ListArgs = {
  json: boolean;
  verbose: boolean;
};

export type WorktreeListEntry = {
  worktree: WorktreeInfo;
  status: WorktreeStatus;
  commit: CommitInfo | null;
  aheadBehind: AheadBehind | null;
};

export type ListResult = {
  entries: WorktreeListEntry[];
};

export type ListDeps = {
  fetchAndPrune: () => Promise<void>;
  listWorktrees: () => Promise<WorktreeInfo[]>;
  getWorktreeStatuses: (worktrees: WorktreeInfo[]) => Promise<WorktreeStatus[]>;
  getLastCommit: (worktreePath: string) => Promise<CommitInfo | null>;
  getAheadBehind: (branch: string, baseBranch: string) => Promise<AheadBehind | null>;
  getMainBranch: () => Promise<string>;
  startSpinner: (message: string) => Spinner;
};

const defaultDeps: ListDeps = {
  fetchAndPrune,
  listWorktrees,
  getWorktreeStatuses,
  getLastCommit,
  getAheadBehind,
  getMainBranch,
  startSpinner,
};

// ANSI color codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";

type StatusBadge = {
  icon: string;
  label: string;
  color: string;
};

export function getStatusBadge(status: WorktreeStatus): StatusBadge {
  if (status.worktree.isMain) {
    return { icon: "*", label: "Main", color: BLUE };
  }
  if (status.worktree.isLocked) {
    return { icon: "🔒", label: "Locked", color: MAGENTA };
  }
  if (status.branchMerged) {
    return { icon: "✓", label: "Merged", color: GREEN };
  }
  if (status.worktree.isDirty) {
    return { icon: "!", label: "Dirty", color: YELLOW };
  }
  return { icon: "●", label: "Active", color: CYAN };
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

export function formatWorktreeEntry(
  entry: WorktreeListEntry,
  repoRoot: string,
  verbose: boolean,
): string[] {
  const { worktree, status, commit, aheadBehind } = entry;
  const badge = getStatusBadge(status);
  const branch = worktree.branch || "(detached)";

  // Line 1: icon + branch (bold) + badge (colored) + ahead/behind
  const abStr = formatAheadBehind(aheadBehind);
  const badgePart = `${badge.color}${badge.label}${RESET}`;
  const abPart = abStr ? `  ${abStr}` : "";
  const line1 = `  ${badge.color}${badge.icon}${RESET} ${BOLD}${branch}${RESET}  ${badgePart}${abPart}`;

  // Line 2: commit hash (dim) + message + relative time (dim)
  let line2: string;
  if (commit) {
    const hash = verbose ? commit.hash : commit.hash;
    const msg = verbose ? commit.message : truncate(commit.message, 50);
    const timeStr = formatRelativeTime(commit.date);
    line2 = `    ${DIM}${hash}${RESET}  ${msg}  ${DIM}${timeStr}${RESET}`;
  } else {
    line2 = `    ${DIM}(no commits)${RESET}`;
  }

  // Line 3: path (dim)
  const pathStr = verbose ? worktree.path : shortenPath(worktree.path, repoRoot);
  const line3 = `    ${DIM}${pathStr}${RESET}`;

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

    const worktrees = await deps.listWorktrees();

    if (worktrees.length > 0) {
      const statuses = await deps.getWorktreeStatuses(worktrees);
      const mainBranch = await deps.getMainBranch();

      // Build entries
      for (const status of statuses) {
        const commit = await deps.getLastCommit(status.worktree.path);

        let aheadBehind: AheadBehind | null = null;
        if (status.worktree.branch && !status.worktree.isMain) {
          aheadBehind = await deps.getAheadBehind(status.worktree.branch, mainBranch);
        }

        result.entries.push({ worktree: status.worktree, status, commit, aheadBehind });
      }
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
        commit: e.commit
          ? { hash: e.commit.hash, message: e.commit.message, date: e.commit.date.toISOString() }
          : null,
        aheadBehind: e.aheadBehind,
      })),
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return result;
  }

  // Rich display
  console.log(`\n${BOLD}Worktrees (${result.entries.length})${RESET}\n`);

  for (const entry of result.entries) {
    // Derive repoRoot from main worktree path or first worktree
    const mainEntry = result.entries.find((e) => e.worktree.isMain);
    const repoRoot = mainEntry ? mainEntry.worktree.path : entry.worktree.path;

    const lines = formatWorktreeEntry(entry, repoRoot, args.verbose);
    for (const line of lines) {
      console.log(line);
    }
    console.log("");
  }

  console.log(formatSummary(result.entries));

  return result;
}
