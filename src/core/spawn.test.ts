import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

import { spawnInteractive } from "./spawn.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

describe("spawnInteractive", () => {
  test("resolves with exit code 0 when the child process exits successfully", async () => {
    await expect(spawnInteractive({ command: "true" })).resolves.toBe(0);
  });

  test("resolves with non-zero exit code when the child process fails", async () => {
    const code = await spawnInteractive({ command: "false" });
    expect(code).toBeGreaterThan(0);
  });

  test("resolves with exit code 0 when using cwd option", async () => {
    await expect(spawnInteractive({ command: "pwd", cwd: "/tmp" })).resolves.toBe(0);
  });

  test("resolves with 1 when close event has null code (e.g. killed by signal)", async () => {
    const fakeProc = new EventEmitter() as ChildProcess;
    // biome-ignore lint/suspicious/noExplicitAny: stub for test
    fakeProc.kill = vi.fn() as any;

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const promise = spawnInteractive({ command: "anything" });

    fakeProc.emit("close", null);

    await expect(promise).resolves.toBe(1);
  });

  test("rejects when spawn emits an error event", async () => {
    const fakeProc = new EventEmitter() as ChildProcess;
    // biome-ignore lint/suspicious/noExplicitAny: stub for test
    fakeProc.kill = vi.fn() as any;

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const promise = spawnInteractive({ command: "anything" });

    // Simulate a spawn error (e.g. ENOENT)
    fakeProc.emit("error", new Error("spawn ENOENT"));

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });
});
