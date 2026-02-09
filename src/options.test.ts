import { describe, expect, test } from "vitest";

import { extractOptions } from "./options";
import type { OptionSchema } from "./types";

describe("extractOptions", () => {
  describe("boolean extraction", () => {
    const schema: OptionSchema = {
      options: {
        verbose: { type: "boolean", flag: "-verbose", alias: "-v" },
        force: { type: "boolean", flag: "-force" },
      },
      unknownHandling: "passthrough",
    };

    test("single boolean flag", () => {
      const result = extractOptions(["-verbose"], schema);
      expect(result.booleans.verbose).toBe(true);
      expect(result.booleans.force).toBe(false);
    });

    test("alias flag", () => {
      const result = extractOptions(["-v"], schema);
      expect(result.booleans.verbose).toBe(true);
    });

    test("multiple boolean flags", () => {
      const result = extractOptions(["-verbose", "-force"], schema);
      expect(result.booleans.verbose).toBe(true);
      expect(result.booleans.force).toBe(true);
    });

    test("default false when absent", () => {
      const result = extractOptions([], schema);
      expect(result.booleans.verbose).toBe(false);
      expect(result.booleans.force).toBe(false);
    });
  });

  describe("string extraction", () => {
    const schema: OptionSchema = {
      options: {
        output: { type: "string", flag: "-output", errorMessage: "-output requires a path" },
      },
      unknownHandling: "passthrough",
    };

    test("string option with value", () => {
      const result = extractOptions(["-output", "dist/"], schema);
      expect(result.strings.output).toBe("dist/");
    });

    test("string option without value throws", () => {
      expect(() => extractOptions(["-output"], schema)).toThrow("-output requires a path");
    });

    test("undefined when absent", () => {
      const result = extractOptions([], schema);
      expect(result.strings.output).toBeUndefined();
    });

    test("string alias flag", () => {
      const aliasSchema: OptionSchema = {
        options: {
          output: { type: "string", flag: "-output", alias: "-o", errorMessage: "-output requires a path" },
        },
        unknownHandling: "passthrough",
      };
      const result = extractOptions(["-o", "dist/"], aliasSchema);
      expect(result.strings.output).toBe("dist/");
    });

    test("string alias without value throws", () => {
      const aliasSchema: OptionSchema = {
        options: {
          output: { type: "string", flag: "-output", alias: "-o", errorMessage: "-output requires a path" },
        },
        unknownHandling: "passthrough",
      };
      expect(() => extractOptions(["-o"], aliasSchema)).toThrow("-output requires a path");
    });
  });

  describe("passthrough mode", () => {
    const schema: OptionSchema = {
      options: {
        flag: { type: "boolean", flag: "-flag" },
      },
      unknownHandling: "passthrough",
    };

    test("unknown args go to remaining", () => {
      const result = extractOptions(["hello", "-flag", "world"], schema);
      expect(result.booleans.flag).toBe(true);
      expect(result.remaining).toEqual(["hello", "world"]);
    });

    test("unknown flags go to remaining in passthrough", () => {
      const result = extractOptions(["-unknown", "text"], schema);
      expect(result.remaining).toEqual(["-unknown", "text"]);
    });
  });

  describe("error mode", () => {
    const schema: OptionSchema = {
      options: {
        force: { type: "boolean", flag: "-force", alias: "-f" },
      },
      unknownHandling: "error",
      unknownErrorPrefix: "Unknown option for test",
    };

    test("unknown flag throws with prefix", () => {
      expect(() => extractOptions(["-unknown"], schema)).toThrow("Unknown option for test: -unknown");
    });

    test("non-flag arguments go to remaining", () => {
      const result = extractOptions(["positional"], schema);
      expect(result.remaining).toEqual(["positional"]);
    });

    test("known flags work normally", () => {
      const result = extractOptions(["-force"], schema);
      expect(result.booleans.force).toBe(true);
    });

    test("default error prefix when not specified", () => {
      const s: OptionSchema = {
        options: {},
        unknownHandling: "error",
      };
      expect(() => extractOptions(["-bad"], s)).toThrow("Unknown option: -bad");
    });
  });

  describe("ignoredFlags", () => {
    const schema: OptionSchema = {
      options: {
        force: { type: "boolean", flag: "-force" },
      },
      unknownHandling: "error",
      ignoredFlags: ["-h", "-help"],
    };

    test("ignored flags are consumed silently", () => {
      const result = extractOptions(["-h"], schema);
      expect(result.booleans.force).toBe(false);
      expect(result.remaining).toEqual([]);
    });

    test("ignored flags don't trigger error mode", () => {
      expect(() => extractOptions(["-help"], schema)).not.toThrow();
    });
  });

  describe("combined scenarios", () => {
    const schema: OptionSchema = {
      options: {
        pane: { type: "boolean", flag: "-pane", alias: "-p" },
        danger: { type: "boolean", flag: "-danger", alias: "-d" },
        base: { type: "string", flag: "-base", alias: "-b", errorMessage: "-base requires a branch name argument" },
        plan: { type: "string", flag: "-plan", errorMessage: "-plan requires a file path argument" },
      },
      unknownHandling: "passthrough",
    };

    test("boolean + string + remaining", () => {
      const result = extractOptions(["-pane", "-base", "develop", "prompt text"], schema);
      expect(result.booleans.pane).toBe(true);
      expect(result.booleans.danger).toBe(false);
      expect(result.strings.base).toBe("develop");
      expect(result.strings.plan).toBeUndefined();
      expect(result.remaining).toEqual(["prompt text"]);
    });

    test("all options mixed order", () => {
      const result = extractOptions(["-danger", "-plan", "plan.md", "-p", "-base", "main", "extra"], schema);
      expect(result.booleans.danger).toBe(true);
      expect(result.booleans.pane).toBe(true);
      expect(result.strings.plan).toBe("plan.md");
      expect(result.strings.base).toBe("main");
      expect(result.remaining).toEqual(["extra"]);
    });

    test("alias interleaved with positionals", () => {
      const result = extractOptions(["-p", "word1", "word2"], schema);
      expect(result.booleans.pane).toBe(true);
      expect(result.remaining).toEqual(["word1", "word2"]);
    });

    test("string alias in combined context", () => {
      const result = extractOptions(["-d", "-b", "develop", "prompt text"], schema);
      expect(result.booleans.danger).toBe(true);
      expect(result.strings.base).toBe("develop");
      expect(result.remaining).toEqual(["prompt text"]);
    });
  });
});
