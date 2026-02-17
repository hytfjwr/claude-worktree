import { describe, expect, test } from "vitest";

import {
  DependencyError,
  ExitCode,
  GitError,
  getErrorMessage,
  HookError,
  isNodeError,
  SlotError,
  toExitCode,
  UsageError,
} from "./errors.ts";

describe("isNodeError", () => {
  test("returns true for Error with code property", () => {
    const err = Object.assign(new Error("fail"), { code: "ENOENT" });
    expect(isNodeError(err)).toBe(true);
  });

  test("narrows to ErrnoException allowing code access", () => {
    const err: unknown = Object.assign(new Error("fail"), { code: "EACCES" });
    if (isNodeError(err)) {
      expect(err.code).toBe("EACCES");
      expect(err.message).toBe("fail");
    } else {
      expect.unreachable("should have been narrowed");
    }
  });

  test("returns true for Error with undefined code (own property)", () => {
    const err = new Error("fail");
    (err as NodeJS.ErrnoException).code = undefined;
    expect(isNodeError(err)).toBe(true);
  });

  test("returns false for Error with non-string code", () => {
    const err = Object.assign(new Error("fail"), { code: 123 });
    expect(isNodeError(err)).toBe(false);
  });

  test("returns false for plain Error without code", () => {
    expect(isNodeError(new Error("no code"))).toBe(false);
  });

  test("returns false for non-Error object with code", () => {
    expect(isNodeError({ code: "ENOENT" })).toBe(false);
  });

  test("returns false for string", () => {
    expect(isNodeError("ENOENT")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isNodeError(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isNodeError(undefined)).toBe(false);
  });
});

describe("getErrorMessage", () => {
  test("extracts message from Error instance", () => {
    expect(getErrorMessage(new Error("something failed"))).toBe("something failed");
  });

  test("converts string to string", () => {
    expect(getErrorMessage("raw error")).toBe("raw error");
  });

  test("converts number to string", () => {
    expect(getErrorMessage(42)).toBe("42");
  });

  test("converts null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  test("converts undefined to string", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  test("converts object to string", () => {
    expect(getErrorMessage({ key: "value" })).toBe("[object Object]");
  });

  test("extracts message from subclassed Error", () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "CustomError";
      }
    }
    expect(getErrorMessage(new CustomError("custom"))).toBe("custom");
  });
});

describe("ExitCode", () => {
  test("has expected values", () => {
    expect(ExitCode.success).toBe(0);
    expect(ExitCode.general).toBe(1);
    expect(ExitCode.usage).toBe(2);
    expect(ExitCode.git).toBe(3);
    expect(ExitCode.dependency).toBe(4);
    expect(ExitCode.hook).toBe(5);
    expect(ExitCode.slot).toBe(6);
    expect(ExitCode.interrupted).toBe(130);
  });
});

describe("typed error classes", () => {
  test("UsageError has correct name and message", () => {
    const err = new UsageError("bad args");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.name).toBe("UsageError");
    expect(err.message).toBe("bad args");
  });

  test("GitError has correct name and message", () => {
    const err = new GitError("not a repo");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GitError);
    expect(err.name).toBe("GitError");
    expect(err.message).toBe("not a repo");
  });

  test("DependencyError has correct name and message", () => {
    const err = new DependencyError("wezterm missing");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DependencyError);
    expect(err.name).toBe("DependencyError");
    expect(err.message).toBe("wezterm missing");
  });

  test("HookError has correct name and message", () => {
    const err = new HookError("hook timed out");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HookError);
    expect(err.name).toBe("HookError");
    expect(err.message).toBe("hook timed out");
  });

  test("SlotError has correct name and message", () => {
    const err = new SlotError("no available slots");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SlotError);
    expect(err.name).toBe("SlotError");
    expect(err.message).toBe("no available slots");
  });
});

describe("toExitCode", () => {
  test("returns usage for UsageError", () => {
    expect(toExitCode(new UsageError("bad"))).toBe(ExitCode.usage);
  });

  test("returns git for GitError", () => {
    expect(toExitCode(new GitError("fail"))).toBe(ExitCode.git);
  });

  test("returns dependency for DependencyError", () => {
    expect(toExitCode(new DependencyError("missing"))).toBe(ExitCode.dependency);
  });

  test("returns hook for HookError", () => {
    expect(toExitCode(new HookError("timeout"))).toBe(ExitCode.hook);
  });

  test("returns slot for SlotError", () => {
    expect(toExitCode(new SlotError("no slots"))).toBe(ExitCode.slot);
  });

  test("returns general for plain Error", () => {
    expect(toExitCode(new Error("unknown"))).toBe(ExitCode.general);
  });

  test("returns general for non-Error", () => {
    expect(toExitCode("string error")).toBe(ExitCode.general);
    expect(toExitCode(null)).toBe(ExitCode.general);
    expect(toExitCode(42)).toBe(ExitCode.general);
  });
});
