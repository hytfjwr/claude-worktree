import { afterEach, describe, expect, test, vi } from "vitest";

import { executeHookWithSpinner } from "./hooks.ts";

vi.mock("../core/config.ts", () => ({
  runHook: vi.fn(),
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
const { startSpinner, createTailUpdater } = await import("../ui/spinner.ts");

const mockRunHook = vi.mocked(runHook);
const mockStartSpinner = vi.mocked(startSpinner);
const mockCreateTailUpdater = vi.mocked(createTailUpdater);

afterEach(() => {
  vi.clearAllMocks();
});

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
    expect(mockRunHook).toHaveBeenCalledWith("echo hello", "/tmp/repo", {
      verbose: false,
      onLine: expect.any(Function),
      timeout: 300,
    });
  });

  test("stops spinner with success message on completion", async () => {
    mockRunHook.mockResolvedValue(undefined);
    const mockStop = vi.fn();
    mockStartSpinner.mockReturnValue({
      stop: mockStop,
      fail: vi.fn(),
      updateTail: vi.fn(),
      isExpanded: vi.fn(() => false),
    });

    await executeHookWithSpinner(baseOptions);

    expect(mockStop).toHaveBeenCalledWith("\u2713 postCreate hook done");
  });

  test("returns failure with message on hook error", async () => {
    mockRunHook.mockRejectedValue(new Error("Hook command failed with exit code 1: echo hello"));

    const result = await executeHookWithSpinner(baseOptions);

    expect(result).toEqual({
      success: false,
      message: "Hook command failed with exit code 1: echo hello",
    });
  });

  test("fails spinner on hook error", async () => {
    mockRunHook.mockRejectedValue(new Error("something went wrong"));
    const mockFail = vi.fn();
    mockStartSpinner.mockReturnValue({
      stop: vi.fn(),
      fail: mockFail,
      updateTail: vi.fn(),
      isExpanded: vi.fn(() => false),
    });

    await executeHookWithSpinner(baseOptions);

    expect(mockFail).toHaveBeenCalledWith("postCreate hook failed");
  });

  test("handles non-Error thrown values", async () => {
    mockRunHook.mockRejectedValue("string error");

    const result = await executeHookWithSpinner(baseOptions);

    expect(result).toEqual({ success: false, message: "string error" });
  });

  test("skips spinner in verbose mode", async () => {
    mockRunHook.mockResolvedValue(undefined);

    await executeHookWithSpinner({ ...baseOptions, verbose: true });

    expect(mockStartSpinner).not.toHaveBeenCalled();
    expect(mockRunHook).toHaveBeenCalledWith("echo hello", "/tmp/repo", {
      verbose: true,
      onLine: undefined,
      timeout: 300,
    });
  });

  test("creates spinner with timeout in non-verbose mode", async () => {
    mockRunHook.mockResolvedValue(undefined);

    await executeHookWithSpinner(baseOptions);

    expect(mockStartSpinner).toHaveBeenCalledWith("Running postCreate hook...", { timeoutSec: 300 });
  });

  test("passes createTailUpdater to onLine when spinner exists", async () => {
    mockRunHook.mockResolvedValue(undefined);
    const mockUpdater = vi.fn();
    mockCreateTailUpdater.mockReturnValue(mockUpdater);

    await executeHookWithSpinner(baseOptions);

    expect(mockCreateTailUpdater).toHaveBeenCalled();
    expect(mockRunHook).toHaveBeenCalledWith("echo hello", "/tmp/repo", {
      verbose: false,
      onLine: mockUpdater,
      timeout: 300,
    });
  });

  test("uses label in spinner and fail messages", async () => {
    mockRunHook.mockRejectedValue(new Error("fail"));
    const mockFail = vi.fn();
    mockStartSpinner.mockReturnValue({
      stop: vi.fn(),
      fail: mockFail,
      updateTail: vi.fn(),
      isExpanded: vi.fn(() => false),
    });

    await executeHookWithSpinner({ ...baseOptions, label: "preClean" });

    expect(mockStartSpinner).toHaveBeenCalledWith("Running preClean hook...", { timeoutSec: 300 });
    expect(mockFail).toHaveBeenCalledWith("preClean hook failed");
  });
});
