import * as readline from "node:readline";

import type { ConfirmOptions, WorktreeInfo, WorktreeStatus } from "../types/index.ts";
import { dim, yellow } from "./color.ts";
import { icons } from "./icons.ts";
import { logInfo } from "./logger.ts";
import { selectMany as selectManyUI, selectSingle } from "./select.ts";

export type { ConfirmOptions } from "../types/index.ts";

const SHOW_CURSOR = "\x1b[?25h";

// Single-byte keys that answer "no". Esc / q / Enter all take the default.
const NO_KEYS = new Set([0x6e, 0x4e, 0x1b, 0x71, 0x51, 0x0d, 0x0a]);
const YES_KEYS = new Set([0x79, 0x59]);
const CTRL_C = 0x03;

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

function renderDangerBlock(message: string, details?: string[]): void {
  logInfo(yellow(`${icons.warning()}  ${message}`));
  for (const detail of details ?? []) {
    logInfo(`  ${dim(detail)}`);
  }
}

function readSingleKey(promptLine: string): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    let handler: ((data: Buffer) => void) | null = null;

    const cleanup = () => {
      if (handler) {
        process.stdin.removeListener("data", handler);
        handler = null;
      }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
      process.stdout.write(SHOW_CURSOR);
    };

    const exitHandler = () => {
      // Restore the terminal on abnormal exit
      if (resolved) return;
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
      process.stdout.write(SHOW_CURSOR);
    };

    const finish = (answer: boolean) => {
      if (resolved) return;
      resolved = true;
      // Echo the decision so the transcript shows what was answered
      process.stdout.write(`${answer ? "y" : "n"}\n`);
      cleanup();
      process.removeListener("exit", exitHandler);
      resolve(answer);
    };

    handler = (data: Buffer) => {
      // Ignore escape sequences and pastes: only a single keypress decides
      if (data.length !== 1) return;
      const byte = data[0];
      if (byte === CTRL_C) {
        cleanup();
        process.removeListener("exit", exitHandler);
        process.exit(130);
      }
      if (YES_KEYS.has(byte)) {
        finish(true);
        return;
      }
      if (NO_KEYS.has(byte)) {
        finish(false);
      }
      // Any other key: keep waiting
    };

    process.on("exit", exitHandler);
    process.stdout.write(promptLine);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", handler);
  });
}

export async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { danger = false, details } = options;
  if (danger) {
    renderDangerBlock(message, details);
  }

  // In danger mode the message is already shown in the heading above
  const label = danger ? "" : `${message} `;

  if (!process.stdin.isTTY) {
    const rl = createReadlineInterface();
    try {
      const answer = await question(rl, `${label}(y/N): `);
      const input = answer.trim().toLowerCase();
      return input === "y" || input === "yes";
    } finally {
      rl.close();
    }
  }

  return readSingleKey(`${label}${dim("(y/N)")} `);
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
