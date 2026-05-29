import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createExecStub } from "../__test-utils__.ts";

// Hoisted mock for ../core/exec
const { mockExecImpl } = vi.hoisted(() => ({
  mockExecImpl: { current: null as ((cmd: string, args: string[]) => unknown) | null },
}));

vi.mock("../core/exec.ts", async (importOriginal) => {
  const original = (await importOriginal()) as { exec: (cmd: string, args: string[]) => unknown };
  return {
    ...original,
    exec: (cmd: string, args: string[]) => {
      if (mockExecImpl.current) {
        return mockExecImpl.current(cmd, args);
      }
      return original.exec(cmd, args);
    },
  };
});

describe("checkGhAvailable", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns true when gh is available", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which" && args.includes("gh")) {
        return { stdout: "/usr/local/bin/gh\n" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { checkGhAvailable } = await import("./github.ts");
    expect(await checkGhAvailable()).toBe(true);
  });

  test("returns false when gh is not available", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "which" && args.includes("gh")) {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { checkGhAvailable } = await import("./github.ts");
    expect(await checkGhAvailable()).toBe(false);
  });
});

describe("getPullRequestsForBranches", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns a map of branch -> PR info on success", async () => {
    const prJson = JSON.stringify([
      {
        number: 123,
        title: "Fix login bug",
        state: "MERGED",
        url: "https://github.com/owner/repo/pull/123",
        headRefName: "feature/login-fix",
      },
      {
        number: 124,
        title: "Add API",
        state: "OPEN",
        url: "https://github.com/owner/repo/pull/124",
        headRefName: "feature/api",
      },
    ]);

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh" && args.includes("pr")) {
        return { stdout: prJson };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    const map = await getPullRequestsForBranches(["feature/login-fix", "feature/api"]);

    expect(map.get("feature/login-fix")).toEqual({
      number: 123,
      title: "Fix login bug",
      state: "MERGED",
      url: "https://github.com/owner/repo/pull/123",
    });
    expect(map.get("feature/api")).toEqual({
      number: 124,
      title: "Add API",
      state: "OPEN",
      url: "https://github.com/owner/repo/pull/124",
    });
  });

  test("returns empty map without calling gh when branch list is empty", async () => {
    let ghCalled = false;
    mockExecImpl.current = createExecStub((cmd) => {
      if (cmd === "gh") ghCalled = true;
      return { stdout: "[]" };
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    const map = await getPullRequestsForBranches([]);

    expect(map.size).toBe(0);
    expect(ghCalled).toBe(false);
  });

  test("excludes branches not in the requested set", async () => {
    const prJson = JSON.stringify([
      { number: 1, title: "Other", state: "OPEN", url: "https://github.com/o/r/pull/1", headRefName: "feature/other" },
    ]);
    mockExecImpl.current = createExecStub((cmd) => {
      if (cmd === "gh") return { stdout: prJson };
      throw new Error(`Unhandled exec call: ${cmd}`);
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    const map = await getPullRequestsForBranches(["feature/wanted"]);

    expect(map.size).toBe(0);
  });

  test("keeps the first (most recent) PR per head branch", async () => {
    const prJson = JSON.stringify([
      {
        number: 200,
        title: "Newer",
        state: "OPEN",
        url: "https://github.com/o/r/pull/200",
        headRefName: "feature/dup",
      },
      {
        number: 100,
        title: "Older",
        state: "CLOSED",
        url: "https://github.com/o/r/pull/100",
        headRefName: "feature/dup",
      },
    ]);
    mockExecImpl.current = createExecStub((cmd) => {
      if (cmd === "gh") return { stdout: prJson };
      throw new Error(`Unhandled exec call: ${cmd}`);
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    const map = await getPullRequestsForBranches(["feature/dup"]);

    expect(map.get("feature/dup")?.number).toBe(200);
  });

  test("returns empty map when gh command fails", async () => {
    mockExecImpl.current = createExecStub((cmd) => {
      if (cmd === "gh") return { stdout: "", exitCode: 1 };
      throw new Error(`Unhandled exec call: ${cmd}`);
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    const map = await getPullRequestsForBranches(["feature/test"]);
    expect(map.size).toBe(0);
  });

  test("returns empty map when JSON is invalid", async () => {
    mockExecImpl.current = createExecStub((cmd) => {
      if (cmd === "gh") return { stdout: "not json" };
      throw new Error(`Unhandled exec call: ${cmd}`);
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    const map = await getPullRequestsForBranches(["feature/test"]);
    expect(map.size).toBe(0);
  });

  test("skips PRs with missing fields or unexpected state", async () => {
    const prJson = JSON.stringify([
      { number: 1, title: "Missing url+state", headRefName: "feature/a" },
      { number: 2, title: "Draft", state: "DRAFT", url: "https://github.com/o/r/pull/2", headRefName: "feature/b" },
      { number: 3, title: "Valid", state: "OPEN", url: "https://github.com/o/r/pull/3", headRefName: "feature/c" },
    ]);
    mockExecImpl.current = createExecStub((cmd) => {
      if (cmd === "gh") return { stdout: prJson };
      throw new Error(`Unhandled exec call: ${cmd}`);
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    const map = await getPullRequestsForBranches(["feature/a", "feature/b", "feature/c"]);

    expect(map.has("feature/a")).toBe(false);
    expect(map.has("feature/b")).toBe(false);
    expect(map.get("feature/c")?.number).toBe(3);
  });

  test("passes correct arguments to gh (state all, headRefName, no per-branch --head)", async () => {
    let capturedArgs: string[] = [];
    mockExecImpl.current = createExecStub((cmd, args) => {
      if (cmd === "gh") {
        capturedArgs = args;
        return { stdout: "[]" };
      }
      throw new Error(`Unhandled exec call: ${cmd}`);
    });

    const { getPullRequestsForBranches } = await import("./github.ts");
    await getPullRequestsForBranches(["feature/auth"]);

    expect(capturedArgs).toContain("pr");
    expect(capturedArgs).toContain("list");
    expect(capturedArgs).toContain("--state");
    expect(capturedArgs).toContain("all");
    expect(capturedArgs).toContain("--json");
    expect(capturedArgs.some((a) => a.includes("headRefName"))).toBe(true);
    expect(capturedArgs).toContain("--limit");
    expect(capturedArgs).not.toContain("--head");
  });
});
