import { describe, expect, test, vi } from "vitest";

import { executeHookWithSpinner } from "./hooks.ts";

vi.mock("../core/config.ts", () => ({
  runHook: vi.fn(),
}));

vi.mock("../ui/icons.ts", () => ({
  icons: {
    success: () => "\u2713",
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

const { runHook } = await import("../core/config.ts");

const mockRunHook = vi.mocked(runHook);

const baseOptions = {
  hookCmd: "echo hello",
  cwd: "/tmp/repo",
  label: "postCreate",
  verbose: false,
  timeout: 300,
};

describe("executeHookWithSpinner", () => {
  test("returns success on hook completion", async () => {
    mockRunHook.mockResolvedValue(undefined);

    const result = await executeHookWithSpinner(baseOptions);

    expect(result).toEqual({ success: true });
  });

  test("returns failure with message on hook error", async () => {
    mockRunHook.mockRejectedValue(new Error("Hook command failed with exit code 1: echo hello"));

    const result = await executeHookWithSpinner(baseOptions);

    expect(result).toEqual({
      success: false,
      message: "Hook command failed with exit code 1: echo hello",
    });
  });

  test("handles non-Error thrown values", async () => {
    mockRunHook.mockRejectedValue("string error");

    const result = await executeHookWithSpinner(baseOptions);

    expect(result).toEqual({ success: false, message: "string error" });
  });
});
