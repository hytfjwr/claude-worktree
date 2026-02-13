import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

import { spawnInteractive } from "./spawn.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

describe("spawnInteractive", () => {
  test("resolves when the child process exits successfully", async () => {
    await expect(spawnInteractive({ command: "true" })).resolves.toBeUndefined();
  });

  test("resolves even when the child process exits with non-zero code", async () => {
    // spawnInteractive does not reject on non-zero exit — it always resolves on close
    await expect(spawnInteractive({ command: "false" })).resolves.toBeUndefined();
  });

  test("uses cwd option for the child process", async () => {
    await expect(spawnInteractive({ command: "pwd", cwd: "/tmp" })).resolves.toBeUndefined();
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
