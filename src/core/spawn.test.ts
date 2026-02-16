import { spawn } from "node:child_process";
import { describe, expect, test, vi } from "vitest";

import { createFakeChildProcess } from "../__test-utils__.ts";
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
    const fakeProc = createFakeChildProcess();

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const promise = spawnInteractive({ command: "anything" });

    fakeProc.emit("close", null);

    await expect(promise).resolves.toBe(1);
  });

  test("rejects when spawn emits an error event", async () => {
    const fakeProc = createFakeChildProcess();

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const promise = spawnInteractive({ command: "anything" });

    // Simulate a spawn error (e.g. ENOENT)
    fakeProc.emit("error", new Error("spawn ENOENT"));

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });

  test("forwards SIGINT to child process", async () => {
    const fakeProc = createFakeChildProcess();

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const promise = spawnInteractive({ command: "anything" });

    try {
      // Emit SIGINT on process — should forward to child
      process.emit("SIGINT", "SIGINT");

      expect(fakeProc.kill).toHaveBeenCalledWith("SIGINT");
    } finally {
      fakeProc.emit("close", 0);
      await promise.catch(() => {});
    }
  });

  test("cleans up signal handlers after child closes", async () => {
    const fakeProc = createFakeChildProcess();

    vi.mocked(spawn).mockReturnValueOnce(fakeProc);

    const listenerCountBefore = process.listenerCount("SIGINT");

    const promise = spawnInteractive({ command: "anything" });

    try {
      // While child is alive, there should be an additional SIGINT listener
      expect(process.listenerCount("SIGINT")).toBeGreaterThan(listenerCountBefore);

      // Close child process
      fakeProc.emit("close", 0);
      await promise;

      // After close, listeners should be cleaned up
      expect(process.listenerCount("SIGINT")).toBe(listenerCountBefore);
    } finally {
      // Ensure cleanup even if assertions fail
      fakeProc.emit("close", 0);
      await promise.catch(() => {});
    }
  });
});
