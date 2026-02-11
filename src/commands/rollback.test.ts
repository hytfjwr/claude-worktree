import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { RollbackOptions } from "../types.ts";

vi.mock("../core/config.ts", () => ({
  runHook: vi.fn(),
}));

vi.mock("../core/git.ts", () => ({
  removeWorktree: vi.fn(),
}));

vi.mock("../core/session.ts", () => ({
  deleteSession: vi.fn(),
}));

vi.mock("../core/slot.ts", () => ({
  deleteSlot: vi.fn(),
}));

vi.mock("../ui/icons.ts", () => ({
  icons: {
    success: () => "\u2713",
    fail: () => "\u2717",
  },
}));

vi.mock("../ui/spinner.ts", () => ({
  startSpinner: vi.fn(() => ({
    stop: vi.fn(),
    fail: vi.fn(),
    updateTail: vi.fn(),
    isExpanded: vi.fn(() => false),
  })),
  createTailUpdater: vi.fn(() => vi.fn()),
}));

// Import mocked modules after vi.mock declarations
const { runHook } = await import("../core/config.ts");
const { removeWorktree } = await import("../core/git.ts");
const { deleteSession } = await import("../core/session.ts");
const { deleteSlot } = await import("../core/slot.ts");
const { performRollback } = await import("./rollback.ts");

const mockedRunHook = vi.mocked(runHook);
const mockedRemoveWorktree = vi.mocked(removeWorktree);
const mockedDeleteSession = vi.mocked(deleteSession);
const mockedDeleteSlot = vi.mocked(deleteSlot);

function baseOptions(overrides?: Partial<RollbackOptions>): RollbackOptions {
  return {
    worktreePath: "/tmp/repo-feature",
    repoRoot: "/tmp/repo",
    preCleanTimeout: 120,
    postCleanTimeout: 60,
    verbose: false,
    deleteSessionData: false,
    ...overrides,
  };
}

describe("performRollback", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test("all steps succeed → no summary printed", async () => {
    const opts = baseOptions({
      preCleanCommand: "echo preClean",
      postCleanCommand: "echo postClean",
      slot: 3,
      deleteSessionData: true,
    });

    await performRollback(opts);

    expect(mockedRunHook).toHaveBeenCalledTimes(2);
    expect(mockedRemoveWorktree).toHaveBeenCalledWith("/tmp/repo-feature");
    expect(mockedDeleteSlot).toHaveBeenCalledWith("/tmp/repo-feature");
    expect(mockedDeleteSession).toHaveBeenCalledWith("/tmp/repo-feature");

    // No "Rollback Summary" or "WARNING" output
    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).not.toContain("Rollback Summary");
    const allWarn = consoleWarnSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allWarn).not.toContain("WARNING");
  });

  test("step fails → summary printed with ✗ marker and error detail", async () => {
    mockedRemoveWorktree.mockRejectedValueOnce(new Error("removal failed"));

    const opts = baseOptions({
      preCleanCommand: "echo preClean",
      postCleanCommand: "echo postClean",
    });

    await performRollback(opts);

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).toContain("\u2713 preClean");
    expect(allOutput).toContain("\u2717 worktree removal (removal failed)");
    expect(allOutput).toContain("\u2713 postClean");

    const allWarn = consoleWarnSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allWarn).toContain("WARNING: Rollback incomplete. Manual cleanup may be required.");
  });

  test("deleteSessionData: false → session cleanup skipped", async () => {
    const opts = baseOptions({
      deleteSessionData: false,
      slot: 1,
    });

    await performRollback(opts);

    expect(mockedDeleteSession).not.toHaveBeenCalled();
    expect(mockedDeleteSlot).toHaveBeenCalledWith("/tmp/repo-feature");
  });

  test("deleteSessionData: true → session cleanup runs", async () => {
    const opts = baseOptions({
      deleteSessionData: true,
    });

    await performRollback(opts);

    expect(mockedDeleteSession).toHaveBeenCalledWith("/tmp/repo-feature");
  });

  test("no hooks configured → only worktree removal runs", async () => {
    const opts = baseOptions();

    await performRollback(opts);

    expect(mockedRunHook).not.toHaveBeenCalled();
    expect(mockedRemoveWorktree).toHaveBeenCalledWith("/tmp/repo-feature");
    expect(mockedDeleteSlot).not.toHaveBeenCalled();
    expect(mockedDeleteSession).not.toHaveBeenCalled();
  });

  test("preClean fails → continues with remaining steps and shows summary", async () => {
    mockedRunHook.mockRejectedValueOnce(new Error("preClean failed"));

    const opts = baseOptions({
      preCleanCommand: "echo preClean",
    });

    await performRollback(opts);

    expect(mockedRemoveWorktree).toHaveBeenCalled();

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).toContain("\u2717 preClean (preClean failed)");
    expect(allOutput).toContain("\u2713 worktree removal");
  });

  test("verbose mode logs error details for each failed step", async () => {
    mockedRunHook.mockRejectedValueOnce(new Error("hook error"));
    mockedRemoveWorktree.mockRejectedValueOnce(new Error("worktree error"));

    const opts = baseOptions({
      preCleanCommand: "echo preClean",
      verbose: true,
    });

    await performRollback(opts);

    const allWarn = consoleWarnSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allWarn).toContain("preClean failed: hook error");
    expect(allWarn).toContain("worktree removal failed: worktree error");
  });
});
