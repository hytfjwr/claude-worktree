import { afterEach, describe, expect, test, vi } from "vitest";

import { printJsonLine } from "./json.ts";

describe("printJsonLine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("writes the JSON-stringified value followed by a newline", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const value = { a: 1, b: "two", c: null };

    printJsonLine(value);

    expect(writeSpy).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledWith(`${JSON.stringify(value)}\n`);
  });

  test("writes output that round-trips through JSON.parse", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const value = { dryRun: false, branch: "feature/auth", paneId: 42, workspaceId: null };

    printJsonLine(value);

    const written = writeSpy.mock.calls[0][0] as string;
    expect(JSON.parse(written)).toEqual(value);
  });
});
