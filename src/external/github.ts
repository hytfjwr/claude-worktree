import { exec } from "../core/exec.ts";
import type { PullRequestInfo } from "../types/index.ts";

export async function checkGhAvailable(): Promise<boolean> {
  try {
    const result = await exec("which", ["gh"]).nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function getPullRequestForBranch(branch: string): Promise<PullRequestInfo | null> {
  try {
    const result = await exec("gh", [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      "number,title,state,url",
      "--limit",
      "1",
    ])
      .nothrow()
      .quiet();
    if (result.exitCode !== 0) return null;
    const parsed: unknown = JSON.parse(result.text());
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const pr = parsed[0] as Record<string, unknown>;
    if (
      typeof pr.number !== "number" ||
      typeof pr.title !== "string" ||
      typeof pr.state !== "string" ||
      typeof pr.url !== "string"
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
    };
  } catch {
    return null;
  }
}
