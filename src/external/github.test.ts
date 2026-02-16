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

describe("getPullRequestForBranch", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecImpl.current = null;
  });
  afterEach(() => {
    mockExecImpl.current = null;
  });

  test("returns PR info on success", async () => {
    const prJson = JSON.stringify([
      { number: 123, title: "Fix login bug", state: "MERGED", url: "https://github.com/owner/repo/pull/123" },
    ]);

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh" && args.includes("pr")) {
        return { stdout: prJson };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestForBranch } = await import("./github.ts");
    const result = await getPullRequestForBranch("feature/login-fix");
    expect(result).toEqual({
      number: 123,
      title: "Fix login bug",
      state: "MERGED",
      url: "https://github.com/owner/repo/pull/123",
    });
  });

  test("returns null when gh command fails", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh") {
        return { stdout: "", exitCode: 1 };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestForBranch } = await import("./github.ts");
    expect(await getPullRequestForBranch("feature/test")).toBeNull();
  });

  test("returns null when result is empty array", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh") {
        return { stdout: "[]" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestForBranch } = await import("./github.ts");
    expect(await getPullRequestForBranch("feature/test")).toBeNull();
  });

  test("returns null when JSON is invalid", async () => {
    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh") {
        return { stdout: "not json" };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestForBranch } = await import("./github.ts");
    expect(await getPullRequestForBranch("feature/test")).toBeNull();
  });

  test("returns null when PR object has missing fields", async () => {
    const prJson = JSON.stringify([{ number: 123, title: "Test" }]);

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh") {
        return { stdout: prJson };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestForBranch } = await import("./github.ts");
    expect(await getPullRequestForBranch("feature/test")).toBeNull();
  });

  test("returns null when PR state is unexpected value", async () => {
    const prJson = JSON.stringify([{ number: 1, title: "Test", state: "DRAFT", url: "https://github.com/o/r/pull/1" }]);

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh") {
        return { stdout: prJson };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestForBranch } = await import("./github.ts");
    expect(await getPullRequestForBranch("feature/test")).toBeNull();
  });

  test("passes correct arguments to gh", async () => {
    let capturedArgs: string[] = [];
    const prJson = JSON.stringify([{ number: 1, title: "Test", state: "OPEN", url: "https://github.com/o/r/pull/1" }]);

    mockExecImpl.current = createExecStub((_cmd, args) => {
      if (_cmd === "gh") {
        capturedArgs = args;
        return { stdout: prJson };
      }
      throw new Error(`Unhandled exec call: ${_cmd} ${args.join(" ")}`);
    });

    const { getPullRequestForBranch } = await import("./github.ts");
    await getPullRequestForBranch("feature/auth");

    expect(capturedArgs).toContain("pr");
    expect(capturedArgs).toContain("list");
    expect(capturedArgs).toContain("--head");
    expect(capturedArgs).toContain("feature/auth");
    expect(capturedArgs).toContain("--state");
    expect(capturedArgs).toContain("all");
    expect(capturedArgs).toContain("--limit");
    expect(capturedArgs).toContain("1");
  });
});
