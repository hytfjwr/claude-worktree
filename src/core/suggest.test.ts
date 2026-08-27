import { describe, expect, test } from "vitest";

import { damerauLevenshteinDistance, findClosestCommand, findClosestMatch, levenshteinDistance } from "./suggest.ts";

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

describe("damerauLevenshteinDistance", () => {
  test("identical strings have distance 0", () => {
    expect(damerauLevenshteinDistance("list", "list")).toBe(0);
  });

  test("an adjacent transposition costs 1", () => {
    expect(damerauLevenshteinDistance("resmue", "resume")).toBe(1);
    expect(damerauLevenshteinDistance("claen", "clean")).toBe(1);
  });

  test("insertion, deletion and substitution cost 1", () => {
    expect(damerauLevenshteinDistance("lists", "list")).toBe(1);
    expect(damerauLevenshteinDistance("lst", "list")).toBe(1);
    expect(damerauLevenshteinDistance("lost", "list")).toBe(1);
  });

  test("unrelated words stay far apart", () => {
    expect(damerauLevenshteinDistance("test", "list")).toBe(2);
    expect(damerauLevenshteinDistance("abc", "xyz")).toBe(3);
  });

  test("empty strings", () => {
    expect(damerauLevenshteinDistance("", "list")).toBe(4);
    expect(damerauLevenshteinDistance("list", "")).toBe(4);
    expect(damerauLevenshteinDistance("", "")).toBe(0);
  });
});

describe("findClosestCommand", () => {
  const commands = ["list", "clean", "resume", "-help", "-version"];

  test("suggests a genuine misspelling", () => {
    expect(findClosestCommand("lst", commands)).toBe("list");
    expect(findClosestCommand("clen", commands)).toBe("clean");
    expect(findClosestCommand("resum", commands)).toBe("resume");
  });

  test("suggests a transposition", () => {
    expect(findClosestCommand("claen", commands)).toBe("clean");
    expect(findClosestCommand("resmue", commands)).toBe("resume");
  });

  test("does not fire on plausible branch names", () => {
    expect(findClosestCommand("test", commands)).toBeNull();
    expect(findClosestCommand("cleanup", commands)).toBeNull();
    expect(findClosestCommand("resumed", commands)).toBeNull();
    expect(findClosestCommand("lists", commands)).toBeNull();
    expect(findClosestCommand("feature/test", commands)).toBeNull();
  });

  test("ignores leading dashes and letter case", () => {
    expect(findClosestCommand("-list", commands)).toBe("list");
    expect(findClosestCommand("help", commands)).toBe("-help");
    expect(findClosestCommand("version", commands)).toBe("-version");
    expect(findClosestCommand("List", commands)).toBe("list");
  });

  test("returns null for empty input and empty candidates", () => {
    expect(findClosestCommand("", commands)).toBeNull();
    expect(findClosestCommand("--", commands)).toBeNull();
    expect(findClosestCommand("list", [])).toBeNull();
  });

  test("prefers the closest candidate", () => {
    expect(findClosestCommand("clen", ["cleanx", "clean"])).toBe("clean");
  });
});
