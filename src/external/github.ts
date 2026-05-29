import { exec } from "../core/exec.ts";
import type { PullRequestInfo } from "../types/index.ts";

// Upper bound on PRs fetched in one `gh pr list` call. `gh` cannot filter by multiple head
// branches server-side, so we fetch the most recent PRs across the repo and map them by head.
// Cleanable branches are recently-worked-on local branches, so their PRs are recent and well
// within this bound. PR info is advisory (shown in clean output, not used for deletion).
const PR_FETCH_LIMIT = 200;

export async function checkGhAvailable(): Promise<boolean> {
  try {
    const result = await exec("which", ["gh"]).nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function parsePullRequest(value: unknown): (PullRequestInfo & { headRefName: string }) | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const pr = value as Record<string, unknown>;
  if (
    typeof pr.number !== "number" ||
    typeof pr.title !== "string" ||
    typeof pr.state !== "string" ||
    typeof pr.url !== "string" ||
    typeof pr.headRefName !== "string"
  ) {
    return null;
  }
  if (pr.state !== "OPEN" && pr.state !== "MERGED" && pr.state !== "CLOSED") {
    return null;
  }
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    url: pr.url,
    headRefName: pr.headRefName,
  };
}

/**
 * Fetch PR info for many branches in a single `gh pr list` call, keyed by head branch name.
 *
 * Replaces per-branch `gh pr list --head <branch>` (one network round-trip per branch) with a
 * single request. Returns the most recent PR per head branch (matching the previous
 * `--limit 1` behavior). Branches with no PR are simply absent from the map. Returns an empty
 * map if `gh` fails or the branch list is empty.
 */
export async function getPullRequestsForBranches(branches: string[]): Promise<Map<string, PullRequestInfo>> {
  const map = new Map<string, PullRequestInfo>();
  if (branches.length === 0) {
    return map;
  }
  const wanted = new Set(branches);
  try {
    const result = await exec("gh", [
      "pr",
      "list",
      "--state",
      "all",
      "--json",
      "number,title,state,url,headRefName",
      "--limit",
      String(PR_FETCH_LIMIT),
    ])
      .nothrow()
      .quiet();
    if (result.exitCode !== 0) {
      return map;
    }
    const parsed: unknown = JSON.parse(result.text());
    if (!Array.isArray(parsed)) {
      return map;
    }
    // `gh pr list` returns PRs newest-first; keep the first (most recent) per head branch.
    for (const item of parsed) {
      const pr = parsePullRequest(item);
      if (pr && wanted.has(pr.headRefName) && !map.has(pr.headRefName)) {
        const { headRefName, ...info } = pr;
        map.set(headRefName, info);
      }
    }
  } catch {
    // Non-critical: callers treat a missing entry as "no PR".
    return map;
  }
  return map;
}
