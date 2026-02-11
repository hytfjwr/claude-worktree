import { describe, expect, test } from "vitest";

import { getErrorMessage, isNodeError } from "./errors.ts";

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
