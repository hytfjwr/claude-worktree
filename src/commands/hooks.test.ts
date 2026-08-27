import { beforeEach, describe, expect, test, vi } from "vitest";

import { executeHookWithSpinner, runHookWithTail } from "./hooks.ts";

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

describe("runHookWithTail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const spinner = {
    stop: vi.fn(),
    fail: vi.fn(),
    updateTail: vi.fn(),
    isExpanded: vi.fn(() => false),
  };

  const baseRunOptions = {
    hookCmd: "echo hello",
    cwd: "/tmp/repo",
    verbose: false,
    timeout: 300,
  };

  test("uses the default runHook and streams output into the spinner tail", async () => {
    mockRunHook.mockResolvedValue(undefined);

    const result = await runHookWithTail({ ...baseRunOptions, spinner });

    expect(result).toEqual({ success: true });
    expect(mockRunHook).toHaveBeenCalledWith("echo hello", "/tmp/repo", {
      verbose: false,
      onLine: expect.any(Function),
      timeout: 300,
    });
  });

  test("omits the tail updater when verbose", async () => {
    mockRunHook.mockResolvedValue(undefined);

    await runHookWithTail({ ...baseRunOptions, verbose: true, spinner });

    expect(mockRunHook).toHaveBeenCalledWith("echo hello", "/tmp/repo", {
      verbose: true,
      onLine: undefined,
      timeout: 300,
    });
  });

  test("omits the tail updater when no spinner is given", async () => {
    mockRunHook.mockResolvedValue(undefined);

    await runHookWithTail(baseRunOptions);

    expect(mockRunHook).toHaveBeenCalledWith("echo hello", "/tmp/repo", {
      verbose: false,
      onLine: undefined,
      timeout: 300,
    });
  });

  test("uses the injected runHook override", async () => {
    const injected = vi.fn(async () => {});

    const result = await runHookWithTail({ ...baseRunOptions, runHook: injected });

    expect(result).toEqual({ success: true });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(mockRunHook).not.toHaveBeenCalled();
  });

  test("returns failure with message when the hook throws", async () => {
    const injected = vi.fn(async () => {
      throw new Error("boom");
    });

    const result = await runHookWithTail({ ...baseRunOptions, runHook: injected });

    expect(result).toEqual({ success: false, message: "boom" });
  });

  test("leaves the spinner untouched (lifecycle belongs to the caller)", async () => {
    mockRunHook.mockRejectedValue(new Error("boom"));

    await runHookWithTail({ ...baseRunOptions, spinner });

    expect(spinner.stop).not.toHaveBeenCalled();
    expect(spinner.fail).not.toHaveBeenCalled();
  });
});
