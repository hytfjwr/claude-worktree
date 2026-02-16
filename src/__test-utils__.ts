import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { vi } from "vitest";

import type { CommitInfo, ExecResult, WorktreeInfo, WorktreeStatus } from "./types/index.ts";

export function makeWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "/tmp/repo-feature-test",
    branch: "feature/test",
    isLocked: false,
    isDirty: false,
    isMain: false,
    ...overrides,
  };
}

export function makeStatus(
  worktreeOverrides: Partial<WorktreeInfo> = {},
  statusOverrides: Partial<Omit<WorktreeStatus, "worktree">> = {},
): WorktreeStatus {
  return {
    worktree: makeWorktree(worktreeOverrides),
    branchMerged: false,
    branchDeletedOnRemote: false,
    canAutoClean: false,
    reason: "Active",
    ...statusOverrides,
  };
}

export function makeCommitInfo(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: "abc1234",
    message: "Fix typo in README",
    date: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

/**
 * Create a fake ExecBuilder that mirrors the real exec() return type contract.
 * - Awaiting returns ExecResult (with sync .text())
 * - .text() on builder returns Promise<string>
 * - .nothrow() suppresses rejection on non-zero exitCode (matching real ExecBuilder)
 * - .quiet() is a chainable no-op
 * Throws for unhandled commands to catch regressions early.
 */
export function createExecStub(
  handler: (cmd: string, args: string[]) => { stdout: string; stderr?: string; exitCode?: number },
) {
  return (cmd: string, args: string[]) => {
    const { stdout, stderr = "", exitCode = 0 } = handler(cmd, args);
    const result: ExecResult = {
      exitCode,
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      text: () => stdout,
    };
    let shouldThrow = true;
    function rejectIfNeeded<T>(fallback: () => Promise<T>): Promise<T> {
      if (exitCode !== 0 && shouldThrow) {
        const msg = `Command failed with exit code ${exitCode}: ${cmd} ${args.join(" ")}${stderr ? `\n${stderr}` : ""}`;
        return Promise.reject(new Error(msg));
      }
      return fallback();
    }
    const builder = {
      nothrow() {
        shouldThrow = false;
        return this;
      },
      quiet() {
        return this;
      },
      text: () => rejectIfNeeded(() => Promise.resolve(stdout)),
      // biome-ignore lint/suspicious/noThenProperty: intentional PromiseLike implementation for exec stub
      then(resolve?: ((value: ExecResult) => unknown) | null, reject?: ((reason: unknown) => unknown) | null) {
        return rejectIfNeeded(() => Promise.resolve(result)).then(resolve, reject);
      },
    };
    return builder;
  };
}

/**
 * Create a fake ChildProcess for testing spawnInteractive.
 * Replaces the `new EventEmitter() as ChildProcess` + `fakeProc.kill = vi.fn() as any` pattern.
 */
export function createFakeChildProcess(): ChildProcess {
  const emitter = new EventEmitter();
  const fakeProc = emitter as ChildProcess;
  fakeProc.kill = vi.fn().mockReturnValue(true);
  return fakeProc;
}

/**
 * Save current values of specified environment variables without modifying them.
 * Returns a restore function for use in afterEach.
 * Use when tests modify env vars within individual test bodies.
 */
export function saveEnv(...keys: string[]): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of keys) {
    saved.set(key, process.env[key]);
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

export function withTTY(isTTY: boolean, fn: () => void) {
  const saved = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (saved) {
      Object.defineProperty(process.stdout, "isTTY", saved);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    }
  }
}
