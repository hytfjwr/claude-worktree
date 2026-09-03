import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { saveEnv } from "../__test-utils__.ts";
import { buildOsc7, reportTerminalCwd } from "./osc.ts";

describe("buildOsc7", () => {
  test("builds an OSC 7 sequence with the host and path", () => {
    expect(buildOsc7("/Users/foo/repo", "myhost")).toBe("\x1b]7;file://myhost/Users/foo/repo\x1b\\");
  });

  test("percent-encodes spaces in the path", () => {
    expect(buildOsc7("/Users/foo/my repo", "myhost")).toBe("\x1b]7;file://myhost/Users/foo/my%20repo\x1b\\");
  });

  test("percent-encodes # in the path", () => {
    expect(buildOsc7("/Users/foo/repo#1", "myhost")).toBe("\x1b]7;file://myhost/Users/foo/repo%231\x1b\\");
  });

  test("percent-encodes multi-byte characters in the path", () => {
    expect(buildOsc7("/Users/foo/日本語", "myhost")).toBe(
      `\x1b]7;file://myhost/Users/foo/${encodeURIComponent("日本語")}\x1b\\`,
    );
  });

  test("keeps / as a separator without encoding it", () => {
    expect(buildOsc7("/a/b/c", "myhost")).toBe("\x1b]7;file://myhost/a/b/c\x1b\\");
  });
});

describe("reportTerminalCwd", () => {
  let restoreEnv: () => void;
  let savedIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    restoreEnv = saveEnv("CLAUDE_WORKTREE_NO_OSC7");
    delete process.env.CLAUDE_WORKTREE_NO_OSC7;
    savedIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  });

  afterEach(() => {
    restoreEnv();
    if (savedIsTTY) {
      Object.defineProperty(process.stdout, "isTTY", savedIsTTY);
    }
    vi.restoreAllMocks();
  });

  test("writes an OSC 7 sequence when stdout is a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    reportTerminalCwd("/Users/foo/repo");

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("]7;file://"));
  });

  test("does not write when stdout is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    reportTerminalCwd("/Users/foo/repo");

    expect(writeSpy).not.toHaveBeenCalled();
  });

  test("does not write when CLAUDE_WORKTREE_NO_OSC7 is set to a non-empty value", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.CLAUDE_WORKTREE_NO_OSC7 = "1";
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    reportTerminalCwd("/Users/foo/repo");

    expect(writeSpy).not.toHaveBeenCalled();
  });
});
