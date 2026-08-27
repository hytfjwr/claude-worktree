import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { saveEnv, withTTY } from "../__test-utils__.ts";
import type { HelpSpec } from "../types/index.ts";
import { _resetColorCache } from "./color.ts";
import { renderHelp } from "./help.ts";

function withColumns(columns: number | undefined, fn: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (saved) {
      Object.defineProperty(process.stdout, "columns", saved);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>).columns;
    }
  }
}

/** Returns the column at which `text` starts on its line, so callers can check description alignment. */
function columnOf(output: string, text: string): number {
  const index = output.indexOf(text);
  const lineStart = output.lastIndexOf("\n", index) + 1;
  return index - lineStart;
}

function makeSampleSpec(): HelpSpec {
  return {
    name: "claude-worktree test",
    tagline: "Sample tagline",
    description: "A short description paragraph for testing.",
    usage: ["claude-worktree test <arg>"],
    sections: [
      {
        title: "Options",
        kind: "options",
        entries: [
          { flags: "-a, -alpha", description: "Alpha option description" },
          { flags: "-b, -beta <value>", description: "Beta option description" },
        ],
      },
      {
        title: "Examples",
        kind: "examples",
        entries: [{ arg: "claude-worktree test example" }],
      },
    ],
  };
}

let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = saveEnv("NO_COLOR");
});

afterEach(() => {
  restoreEnv();
  _resetColorCache();
});

describe("renderHelp", () => {
  test("includes the header, description, usage, and section headings", () => {
    withTTY(false, () => {
      withColumns(80, () => {
        const output = renderHelp(makeSampleSpec());
        expect(output).toContain("claude-worktree test");
        expect(output).toContain("Sample tagline");
        expect(output).toContain("A short description paragraph for testing.");
        expect(output).toContain("Usage:");
        expect(output).toContain("claude-worktree test <arg>");
        expect(output).toContain("Options:");
      });
    });
  });

  test("aligns the description column across entries of different flag lengths", () => {
    withTTY(false, () => {
      withColumns(80, () => {
        const spec: HelpSpec = {
          name: "claude-worktree test",
          tagline: "Test",
          usage: [],
          sections: [
            {
              title: "Options",
              kind: "options",
              entries: [
                { flags: "-a", description: "Short flag" },
                { flags: "-b, -base <branch>", description: "Longer flag" },
                { flags: "-x, -xx", description: "Medium flag" },
              ],
            },
          ],
        };
        const output = renderHelp(spec);
        const shortCol = columnOf(output, "Short flag");
        const longCol = columnOf(output, "Longer flag");
        const mediumCol = columnOf(output, "Medium flag");
        expect(shortCol).toBe(longCol);
        expect(longCol).toBe(mediumCol);
      });
    });
  });

  test("wraps a long description and indents continuation lines to the description column", () => {
    withTTY(false, () => {
      withColumns(80, () => {
        const label = "-x, -example <value>";
        const spec: HelpSpec = {
          name: "claude-worktree test",
          tagline: "Test",
          usage: [],
          sections: [
            {
              title: "Options",
              kind: "options",
              entries: [
                {
                  flags: label,
                  description:
                    "This is a very long description that should wrap across multiple lines because it does not fit on a single row of an eighty column wide terminal for certain.",
                },
              ],
            },
          ],
        };
        const output = renderHelp(spec);
        const optionsBlock = output.slice(output.indexOf("Options:"));
        const optionsLines = optionsBlock.split("\n");
        const descColumn = 2 + label.length + 2;
        // optionsLines[0] is the "Options:" heading, optionsLines[1] is the first entry line
        expect(optionsLines.length).toBeGreaterThan(2);
        for (const line of optionsLines.slice(2)) {
          if (line.length === 0) {
            continue;
          }
          const leadingSpaces = line.length - line.trimStart().length;
          expect(leadingSpaces).toBe(descColumn);
        }
      });
    });
  });

  test("switches to a stacked layout when the terminal is too narrow for two columns", () => {
    withTTY(false, () => {
      withColumns(40, () => {
        const spec: HelpSpec = {
          name: "claude-worktree test",
          tagline: "Test",
          usage: [],
          sections: [
            {
              title: "Options",
              kind: "options",
              entries: [
                { flags: "-b, -base <branch>", description: "Specify the base branch to use for the worktree" },
              ],
            },
          ],
        };
        const output = renderHelp(spec);
        const lines = output.split("\n");
        const flagLineIndex = lines.findIndex((line) => line.includes("-b, -base <branch>"));
        expect(flagLineIndex).toBeGreaterThanOrEqual(0);
        expect(lines[flagLineIndex + 1].startsWith("    ")).toBe(true);
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(40);
        }
      });
    });
  });

  test("caps the rendered width at 100 columns even when the terminal is very wide", () => {
    withTTY(false, () => {
      withColumns(500, () => {
        const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
        const spec: HelpSpec = {
          name: "claude-worktree test",
          tagline: "Test",
          description: words,
          usage: ["claude-worktree test <arg>"],
          sections: [
            {
              title: "Options",
              kind: "options",
              entries: [{ flags: "-a, -alpha <value>", description: words }],
            },
          ],
        };
        const output = renderHelp(spec);
        for (const line of output.split("\n")) {
          expect(line.length).toBeLessThanOrEqual(100);
        }
      });
    });
  });

  test("treats undefined terminal columns as width 80", () => {
    withTTY(false, () => {
      withColumns(undefined, () => {
        const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
        const spec: HelpSpec = {
          name: "claude-worktree test",
          tagline: "Test",
          description: words,
          usage: ["claude-worktree test <arg>"],
          sections: [
            {
              title: "Options",
              kind: "options",
              entries: [{ flags: "-a, -alpha <value>", description: words }],
            },
          ],
        };
        const output = renderHelp(spec);
        for (const line of output.split("\n")) {
          expect(line.length).toBeLessThanOrEqual(80);
        }
      });
    });
  });

  test("produces no ANSI escape codes when NO_COLOR is set", () => {
    withTTY(true, () => {
      process.env.NO_COLOR = "1";
      _resetColorCache();
      const output = renderHelp(makeSampleSpec());
      expect(output).not.toContain("\x1b");
    });
  });

  test("colorizes headings and flags when TTY and NO_COLOR are not set", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      const output = renderHelp(makeSampleSpec());
      expect(output).toContain("\x1b[1m"); // bold heading
      expect(output).toContain("\x1b[36m"); // cyan flag
    });
  });

  test("skips a section whose entries array is empty", () => {
    withTTY(false, () => {
      const spec: HelpSpec = {
        name: "claude-worktree test",
        tagline: "Test",
        usage: [],
        sections: [
          { title: "Empty", kind: "options", entries: [] },
          { title: "Options", kind: "options", entries: [{ flags: "-a", description: "Alpha" }] },
        ],
      };
      const output = renderHelp(spec);
      expect(output).not.toContain("Empty:");
      expect(output).toContain("Options:");
    });
  });

  test("renders examples as-is with a fixed indent, without wrapping or colorizing", () => {
    withTTY(true, () => {
      delete process.env.NO_COLOR;
      _resetColorCache();
      const longExample =
        "claude-worktree feature/very-long-branch-name-that-would-otherwise-wrap 'A fairly long prompt describing the task in detail'";
      const spec: HelpSpec = {
        name: "claude-worktree test",
        tagline: "Test",
        usage: [],
        sections: [{ title: "Examples", kind: "examples", entries: [{ arg: longExample }] }],
      };
      const output = renderHelp(spec);
      const exampleLine = output.split("\n").find((line) => line.includes(longExample));
      expect(exampleLine).toBe(`  ${longExample}`);
    });
  });

  test("omits the Usage heading when usage is an empty array", () => {
    withTTY(false, () => {
      const spec: HelpSpec = {
        name: "claude-worktree test",
        tagline: "Test",
        usage: [],
        sections: [{ title: "Options", kind: "options", entries: [{ flags: "-a", description: "Alpha" }] }],
      };
      const output = renderHelp(spec);
      expect(output).not.toContain("Usage:");
    });
  });
});
