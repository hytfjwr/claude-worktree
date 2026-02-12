import { describe, expect, test } from "vitest";

import { getVersion } from "./version.ts";

describe("getVersion", () => {
  test("returns a semver string", () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("does not return 'unknown'", () => {
    const version = getVersion();
    expect(version).not.toBe("unknown");
  });
});
