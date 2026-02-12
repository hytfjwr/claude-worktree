import * as readline from "node:readline";

import type { WorktreeInfo, WorktreeStatus } from "../types.ts";
import { selectMany as selectManyUI, selectSingle } from "./select.ts";

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

export async function confirm(message: string): Promise<boolean> {
  const rl = createReadlineInterface();
  try {
    const answer = await question(rl, `${message} (y/N): `);
    const input = answer.trim().toLowerCase();
    return input === "y" || input === "yes";
  } finally {
    rl.close();
  }
}

export async function selectWorktree(worktrees: WorktreeInfo[]): Promise<WorktreeInfo | null> {
  const items = worktrees.map((wt) => ({
    value: wt,
    label: wt.branch || "(detached)",
    description: wt.path,
  }));
  return selectSingle({ message: "Select worktree to resume:", items });
}

export async function selectMultiple(statuses: WorktreeStatus[]): Promise<WorktreeStatus[]> {
  const items = statuses.map((s) => ({
    value: s,
    label: s.worktree.branch || "(detached)",
    description: s.worktree.path,
    hint: s.reason,
  }));
  return selectManyUI({ message: "Select worktrees to clean:", items });
}
