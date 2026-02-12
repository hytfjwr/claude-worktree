import * as readline from "node:readline";

import type { WorktreeInfo, WorktreeStatus } from "../types.ts";
import { icons } from "./icons.ts";

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
  console.log("\nSelect a worktree to resume (enter number, empty to cancel):\n");

  worktrees.forEach((wt, index) => {
    const branch = wt.branch || "(detached)";
    console.log(`  ${index + 1}. ${branch}`);
    console.log(`     ${wt.path}`);
  });

  const rl = createReadlineInterface();
  try {
    const answer = await question(rl, "\nSelection: ");
    const input = answer.trim();

    if (!input) {
      return null;
    }

    const idx = Number.parseInt(input, 10) - 1;
    if (idx < 0 || idx >= worktrees.length || Number.isNaN(idx)) {
      return null;
    }

    return worktrees[idx];
  } finally {
    rl.close();
  }
}

export async function selectMultiple(statuses: WorktreeStatus[]): Promise<WorktreeStatus[]> {
  console.log("\nSelect worktrees to delete (enter numbers separated by spaces):");
  console.log("Example: 1 3 5 or 'all' to select all, empty to cancel\n");

  statuses.forEach((status, index) => {
    const marker = status.canAutoClean ? icons.active() : icons.inactive();
    const branch = status.worktree.branch || "(detached)";
    console.log(`  ${index + 1}. ${marker} ${branch}`);
    console.log(`     Path: ${status.worktree.path}`);
    console.log(`     Status: ${status.reason}`);
  });

  const rl = createReadlineInterface();
  try {
    const answer = await question(rl, "\nSelection: ");
    const input = answer.trim().toLowerCase();

    if (!input) {
      return [];
    }

    if (input === "all") {
      return statuses;
    }

    const indices = input
      .split(/\s+/)
      .map((s) => Number.parseInt(s, 10) - 1)
      .filter((i) => i >= 0 && i < statuses.length);

    return indices.map((i) => statuses[i]);
  } finally {
    rl.close();
  }
}
