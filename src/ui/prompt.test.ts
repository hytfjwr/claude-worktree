import { afterEach, describe, expect, test, vi } from "vitest";

import type { WorktreeInfo, WorktreeStatus } from "../types/index.ts";

// =============================================================================
// Mocks
// =============================================================================

let mockRlAnswer = "";
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: (answer: string) => void) => cb(mockRlAnswer),
    close: vi.fn(),
  }),
}));

const mockSelectSingle = vi.fn();
const mockSelectMany = vi.fn();
vi.mock("./select.ts", () => ({
  selectSingle: (...args: unknown[]) => mockSelectSingle(...args),
  selectMany: (...args: unknown[]) => mockSelectMany(...args),
}));

import { confirm, selectMultiple, selectWorktree } from "./prompt.ts";

afterEach(() => {
  vi.restoreAllMocks();
  mockSelectSingle.mockReset();
  mockSelectMany.mockReset();
});

// =============================================================================
// confirm
// =============================================================================

describe("confirm", () => {
  test("returns true for 'y'", async () => {
    mockRlAnswer = "y";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for 'yes'", async () => {
    mockRlAnswer = "yes";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for 'Y' (case insensitive)", async () => {
    mockRlAnswer = "Y";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for 'YES' (case insensitive)", async () => {
    mockRlAnswer = "YES";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns true for input with whitespace", async () => {
    mockRlAnswer = "  y  ";
    expect(await confirm("Delete?")).toBe(true);
  });

  test("returns false for 'n'", async () => {
    mockRlAnswer = "n";
    expect(await confirm("Delete?")).toBe(false);
  });

  test("returns false for empty input", async () => {
    mockRlAnswer = "";
    expect(await confirm("Delete?")).toBe(false);
  });

  test("returns false for arbitrary text", async () => {
    mockRlAnswer = "maybe";
    expect(await confirm("Delete?")).toBe(false);
  });

  test("returns false for 'ye' (partial match)", async () => {
    mockRlAnswer = "ye";
    expect(await confirm("Delete?")).toBe(false);
  });
});

// =============================================================================
// selectWorktree
// =============================================================================

describe("selectWorktree", () => {
  const worktrees: WorktreeInfo[] = [
    { path: "/repo/wt/feat-auth", branch: "feat/auth", isLocked: false, isDirty: false, isMain: false },
    { path: "/repo/wt/detached", branch: null, isLocked: false, isDirty: false, isMain: false },
  ];

  test("maps WorktreeInfo to SelectItem correctly", async () => {
    mockSelectSingle.mockResolvedValue(worktrees[0]);

    await selectWorktree(worktrees);

    expect(mockSelectSingle).toHaveBeenCalledWith({
      message: "Select worktree to resume:",
      items: [
        { value: worktrees[0], label: "feat/auth", description: "/repo/wt/feat-auth" },
        { value: worktrees[1], label: "(detached)", description: "/repo/wt/detached" },
      ],
    });
  });

  test("returns selected worktree", async () => {
    mockSelectSingle.mockResolvedValue(worktrees[0]);

    const result = await selectWorktree(worktrees);
    expect(result).toBe(worktrees[0]);
  });

  test("returns null when user cancels", async () => {
    mockSelectSingle.mockResolvedValue(null);

    const result = await selectWorktree(worktrees);
    expect(result).toBeNull();
  });
});

// =============================================================================
// selectMultiple
// =============================================================================

describe("selectMultiple", () => {
  const statuses: WorktreeStatus[] = [
    {
      worktree: { path: "/repo/wt/feat-a", branch: "feat/a", isLocked: false, isDirty: false, isMain: false },
      branchMerged: true,
      branchDeletedOnRemote: false,
      canAutoClean: true,
      reason: "branch merged",
    },
    {
      worktree: { path: "/repo/wt/detached", branch: null, isLocked: false, isDirty: false, isMain: false },
      branchMerged: false,
      branchDeletedOnRemote: true,
      canAutoClean: true,
      reason: "remote deleted",
    },
  ];

  test("maps WorktreeStatus to SelectItem correctly", async () => {
    mockSelectMany.mockResolvedValue([statuses[0]]);

    await selectMultiple(statuses);

    expect(mockSelectMany).toHaveBeenCalledWith({
      message: "Select worktrees to clean:",
      items: [
        { value: statuses[0], label: "feat/a", description: "/repo/wt/feat-a", hint: "branch merged" },
        { value: statuses[1], label: "(detached)", description: "/repo/wt/detached", hint: "remote deleted" },
      ],
    });
  });

  test("returns selected statuses", async () => {
    mockSelectMany.mockResolvedValue([statuses[0], statuses[1]]);

    const result = await selectMultiple(statuses);
    expect(result).toEqual([statuses[0], statuses[1]]);
  });

  test("returns empty array when user cancels", async () => {
    mockSelectMany.mockResolvedValue([]);

    const result = await selectMultiple(statuses);
    expect(result).toEqual([]);
  });
});
