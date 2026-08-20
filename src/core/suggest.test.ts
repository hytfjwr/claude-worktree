import { describe, expect, test } from "vitest";

import { findClosestMatch, levenshteinDistance } from "./suggest.ts";

describe("levenshteinDistance", () => {
  test("identical strings have distance 0", () => {
    expect(levenshteinDistance("pane", "pane")).toBe(0);
  });

  test("empty string equals the other string's length", () => {
    expect(levenshteinDistance("", "pane")).toBe(4);
    expect(levenshteinDistance("pane", "")).toBe(4);
    expect(levenshteinDistance("", "")).toBe(0);
  });

  test("substitution costs 1", () => {
    expect(levenshteinDistance("pane", "pana")).toBe(1);
  });

  test("insertion costs 1", () => {
    expect(levenshteinDistance("pane", "panne")).toBe(1);
  });

  test("deletion costs 1", () => {
    expect(levenshteinDistance("verbose", "verbse")).toBe(1);
  });

  test("transposition costs 2", () => {
    expect(levenshteinDistance("pane", "paen")).toBe(2);
  });

  test("completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });
});

describe("findClosestMatch", () => {
  const flags = ["-pane", "-p", "-danger", "-d", "-dry-run", "-verbose", "-v", "-base", "-b", "-help"];

  test("suggests the flag one edit away", () => {
    expect(findClosestMatch("-panne", flags)).toBe("-pane");
    expect(findClosestMatch("-verbse", flags)).toBe("-verbose");
    expect(findClosestMatch("-bse", flags)).toBe("-base");
  });

  test("suggests the flag two edits away for longer inputs", () => {
    expect(findClosestMatch("-vrbse", flags)).toBe("-verbose");
  });

  test("suggests a flag with two adjacent letters swapped", () => {
    expect(findClosestMatch("-hepl", flags)).toBe("-help");
    expect(findClosestMatch("-pnae", flags)).toBe("-pane");
  });

  test("ignores leading dashes on both sides", () => {
    expect(findClosestMatch("--pane", flags)).toBe("-pane");
    expect(findClosestMatch("pane", flags)).toBe("-pane");
  });

  test("ignores letter case", () => {
    expect(findClosestMatch("-Pane", flags)).toBe("-pane");
    expect(findClosestMatch("-P", flags)).toBe("-p");
  });

  test("treats a prefix as an exact match", () => {
    expect(findClosestMatch("-dry", flags)).toBe("-dry-run");
    expect(findClosestMatch("-ver", flags)).toBe("-verbose");
  });

  test("prefixes shorter than 3 characters are not enough", () => {
    expect(findClosestMatch("-dr", flags)).toBeNull();
  });

  test("returns null for inputs too short to guess", () => {
    expect(findClosestMatch("-x", flags)).toBeNull();
    expect(findClosestMatch("-zz", flags)).toBeNull();
  });

  test("returns null when nothing is close enough", () => {
    expect(findClosestMatch("-completely-unrelated", flags)).toBeNull();
    expect(findClosestMatch("-foo", flags)).toBeNull();
  });

  test("returns null for empty input and empty candidates", () => {
    expect(findClosestMatch("--", flags)).toBeNull();
    expect(findClosestMatch("", flags)).toBeNull();
    expect(findClosestMatch("-pane", [])).toBeNull();
  });

  test("prefers the closest candidate over a merely acceptable one", () => {
    expect(findClosestMatch("-verbse", ["-verboose", "-verbose"])).toBe("-verbose");
  });

  test("ties are resolved in favor of the first candidate", () => {
    expect(findClosestMatch("-pans", ["-pane", "-pant"])).toBe("-pane");
  });

  test("works for branch names", () => {
    const branches = ["feature/auth", "fix/bug-123", "main"];
    expect(findClosestMatch("feature/auht", branches)).toBe("feature/auth");
    expect(findClosestMatch("feature/aut", branches)).toBe("feature/auth");
    expect(findClosestMatch("chore/release", branches)).toBeNull();
  });
});
