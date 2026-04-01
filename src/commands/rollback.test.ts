import { beforeEach, describe, expect, test, vi } from "vitest";

import type { RollbackOptions } from "../types/index.ts";

vi.mock("../core/config.ts", () => ({
  runHook: vi.fn(),
}));

vi.mock("../core/git.ts", () => ({
  removeWorktree: vi.fn(),
  deleteLocalBranch: vi.fn(),
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
    warning: () => "\u26A0",
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
const { removeWorktree, deleteLocalBranch } = await import("../core/git.ts");
const { deleteSession } = await import("../core/session.ts");
const { performRollback } = await import("./rollback.ts");

const mockedRunHook = vi.mocked(runHook);
const mockedRemoveWorktree = vi.mocked(removeWorktree);
const mockedDeleteLocalBranch = vi.mocked(deleteLocalBranch);
const mockedDeleteSession = vi.mocked(deleteSession);

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
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("all steps succeed → no summary printed", async () => {
    const opts = baseOptions({
      preCleanCommand: "echo preClean",
      postCleanCommand: "echo postClean",
      slot: 3,
      deleteSessionData: true,
    });

    await performRollback(opts);

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

  test("deleteSessionData: false → session cleanup absent from summary", async () => {
    mockedRemoveWorktree.mockRejectedValueOnce(new Error("removal failed"));

    const opts = baseOptions({
      deleteSessionData: false,
      slot: 1,
    });

    await performRollback(opts);

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).not.toContain("session cleanup");
  });

  test("deleteSessionData: true → session cleanup appears in summary", async () => {
    mockedRemoveWorktree.mockRejectedValueOnce(new Error("removal failed"));
    mockedDeleteSession.mockResolvedValueOnce(undefined);

    const opts = baseOptions({
      deleteSessionData: true,
    });

    await performRollback(opts);

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).toContain("\u2713 session cleanup");
  });

  test("no hooks configured → summary only shows worktree-related steps", async () => {
    mockedRemoveWorktree.mockRejectedValueOnce(new Error("removal failed"));

    const opts = baseOptions();

    await performRollback(opts);

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).toContain("\u2717 worktree removal");
    expect(allOutput).not.toContain("preClean");
    expect(allOutput).not.toContain("postClean");
  });

  test("preClean fails → continues with remaining steps and shows summary", async () => {
    mockedRunHook.mockRejectedValueOnce(new Error("preClean failed"));

    const opts = baseOptions({
      preCleanCommand: "echo preClean",
    });

    await performRollback(opts);

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).toContain("\u2717 preClean (preClean failed)");
    expect(allOutput).toContain("\u2713 worktree removal");
  });

  test("preClean and removeWorktree both fail → all failures shown in summary", async () => {
    mockedRunHook.mockRejectedValueOnce(new Error("hook error"));
    mockedRemoveWorktree.mockRejectedValueOnce(new Error("worktree error"));

    const opts = baseOptions({
      preCleanCommand: "echo preClean",
    });

    await performRollback(opts);

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).toContain("\u2717 preClean (hook error)");
    expect(allOutput).toContain("\u2717 worktree removal (worktree error)");

    const allWarn = consoleWarnSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allWarn).toContain("WARNING: Rollback incomplete. Manual cleanup may be required.");
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

  test("branchName specified → deletes local branch after worktree removal", async () => {
    const opts = baseOptions({ branchName: "feature/test" });

    await performRollback(opts);

    expect(mockedDeleteLocalBranch).toHaveBeenCalledWith("feature/test", true);
  });

  test("branchName not specified → skips branch deletion", async () => {
    const opts = baseOptions();

    await performRollback(opts);

    expect(mockedDeleteLocalBranch).not.toHaveBeenCalled();
  });

  test("branch deletion fails → continues and shows in summary", async () => {
    mockedDeleteLocalBranch.mockRejectedValueOnce(new Error("branch not found"));

    const opts = baseOptions({ branchName: "feature/test" });

    await performRollback(opts);

    const allOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Rollback Summary");
    expect(allOutput).toContain("\u2717 branch deletion (branch not found)");
  });

  test("verbose: true + all steps succeed → no warnings logged", async () => {
    const opts = baseOptions({
      preCleanCommand: "echo preClean",
      verbose: true,
    });

    await performRollback(opts);

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
