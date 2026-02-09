import { describe, expect, test } from "bun:test";

import { parseArgs, parseCleanArgs, parseCreateArgs, parseListArgs } from "./cli";

describe("parseArgs", () => {
  describe("help", () => {
    test("empty args - returns help", () => {
      const result = parseArgs([]);
      expect(result).toEqual({ type: "help" });
    });

    test("-h flag - returns help", () => {
      const result = parseArgs(["-h"]);
      expect(result).toEqual({ type: "help" });
    });

    test("-help flag - returns help", () => {
      const result = parseArgs(["-help"]);
      expect(result).toEqual({ type: "help" });
    });

    test("-h in the middle - returns help", () => {
      const result = parseArgs(["feature/test", "-h", "prompt"]);
      expect(result).toEqual({ type: "help" });
    });

    test("-help in the middle - returns help", () => {
      const result = parseArgs(["clean", "-help"]);
      expect(result).toEqual({ type: "help" });
    });
  });

  describe("clean", () => {
    test("basic - clean command", () => {
      const result = parseArgs(["clean"]);
      expect(result).toEqual({
        type: "clean",
        args: { force: false, all: false, dryRun: false, verbose: false },
      });
    });

    test("clean + create args - interpreted as clean", () => {
      const result = parseArgs(["clean"]);
      expect(result.type).toBe("clean");
    });
  });

  describe("list", () => {
    test("basic - list command", () => {
      const result = parseArgs(["list"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, verbose: false },
      });
    });

    test("list -json", () => {
      const result = parseArgs(["list", "-json"]);
      expect(result).toEqual({
        type: "list",
        args: { json: true, verbose: false },
      });
    });

    test("list -verbose", () => {
      const result = parseArgs(["list", "-verbose"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, verbose: true },
      });
    });

    test("list -v", () => {
      const result = parseArgs(["list", "-v"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, verbose: true },
      });
    });

    test("list -json -verbose", () => {
      const result = parseArgs(["list", "-json", "-verbose"]);
      expect(result).toEqual({
        type: "list",
        args: { json: true, verbose: true },
      });
    });
  });

  describe("create", () => {
    test("branch + prompt - basic create", () => {
      const result = parseArgs(["feature/auth", "Implement authentication feature"]);
      expect(result).toEqual({
        type: "create",
        args: {
          branchName: "feature/auth",
          prompt: "Implement authentication feature",
          planFile: undefined,
          danger: false,
          merge: false,
          draft: false,
          baseBranch: undefined,
          pane: false,
          verbose: false,
        },
      });
    });
  });
});

describe("parseCreateArgs", () => {
  test("basic - branch + prompt", () => {
    const result = parseCreateArgs(["feature/test", "Test prompt"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Test prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-plan option", () => {
    const result = parseCreateArgs(["feature/api", "-plan", "./plan.md"]);
    expect(result).toEqual({
      branchName: "feature/api",
      prompt: "",
      planFile: "./plan.md",
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-danger option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-d option (alias for -danger)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-d"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-danger + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-plan", "plan.md", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-merge option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: true,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-m option (alias for -merge)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-m"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: true,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-merge + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-merge", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: true,
      merge: true,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-merge + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-plan", "plan.md", "-merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: false,
      merge: true,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("all options combined -merge + -danger + -plan", () => {
    const result = parseCreateArgs(["feature/test", "-plan", "plan.md", "-merge", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: true,
      merge: true,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-base option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("-b option (alias for -base)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-b", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("-base + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-base", "develop", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("-base + -merge options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-base", "develop", "-merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: true,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("-base + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-base", "develop", "-plan", "plan.md"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: false,
      merge: false,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("all options combined -base + -merge + -danger + -plan", () => {
    const result = parseCreateArgs(["feature/test", "-base", "develop", "-plan", "plan.md", "-merge", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: true,
      merge: true,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("-draft option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-draft"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: true,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-draft + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-draft", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: true,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-draft + -base options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-draft", "-base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: true,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("-draft + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-draft", "-plan", "plan.md"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: false,
      merge: false,
      draft: true,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("-pane option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pane"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
    });
  });

  test("-p option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-p"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
    });
  });

  test("-pane + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pane", "-danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
    });
  });

  test("-pane + -draft + -base options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pane", "-draft", "-base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: true,
      baseBranch: "develop",
      pane: true,
      verbose: false,
    });
  });

  test("-verbose option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-v"]);
    expect(result.verbose).toBe(true);
  });

  test("-p does not become part of prompt", () => {
    const result = parseCreateArgs(["feature/test", "-p", "Prompt"]);
    expect(result.pane).toBe(true);
    expect(result.prompt).toBe("Prompt");
  });

  test("error: -merge and -draft are mutually exclusive", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-merge", "-draft"])).toThrow(
      "Cannot use both -merge and -draft options",
    );
  });

  test("error: -base without argument", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-base"])).toThrow("-base requires a branch name argument");
  });

  test("error: not enough arguments (0)", () => {
    expect(() => parseCreateArgs([])).toThrow("Usage:");
  });

  test("error: no prompt and no -plan", () => {
    expect(() => parseCreateArgs(["feature/test"])).toThrow("A prompt or -plan option is required");
  });

  test("error: -plan without argument", () => {
    expect(() => parseCreateArgs(["feature/test", "-plan"])).toThrow("-plan requires a file path argument");
  });

  test("error: both -plan and inline prompt", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-plan", "plan.md"])).toThrow(
      "Cannot use both -plan and inline prompt",
    );
  });

  test("multi-word inline prompt", () => {
    const result = parseCreateArgs(["feature/test", "this", "is", "multi-word"]);
    expect(result.prompt).toBe("this is multi-word");
  });

  test("error: unknown option -unknown", () => {
    expect(() => parseCreateArgs(["feature/test", "-unknown", "text"])).toThrow("Unknown option: -unknown");
  });

  test("error: unknown short option -x", () => {
    expect(() => parseCreateArgs(["feature/test", "-x"])).toThrow("Unknown option: -x");
  });

  test("error: unknown option after prompt", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-foo"])).toThrow("Unknown option: -foo");
  });
});

describe("parseCleanArgs", () => {
  test("basic - no options", () => {
    const result = parseCleanArgs([]);
    expect(result).toEqual({ force: false, all: false, dryRun: false, verbose: false });
  });

  test("-force flag", () => {
    const result = parseCleanArgs(["-force"]);
    expect(result.force).toBe(true);
  });

  test("-f flag", () => {
    const result = parseCleanArgs(["-f"]);
    expect(result.force).toBe(true);
  });

  test("-all flag", () => {
    const result = parseCleanArgs(["-all"]);
    expect(result.all).toBe(true);
  });

  test("-a flag", () => {
    const result = parseCleanArgs(["-a"]);
    expect(result.all).toBe(true);
  });

  test("-dry-run flag", () => {
    const result = parseCleanArgs(["-dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  test("-n flag", () => {
    const result = parseCleanArgs(["-n"]);
    expect(result.dryRun).toBe(true);
  });

  test("combined flags - -force -all -dry-run", () => {
    const result = parseCleanArgs(["-force", "-all", "-dry-run"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true, verbose: false });
  });

  test("combined short flags - -f -a -n", () => {
    const result = parseCleanArgs(["-f", "-a", "-n"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true, verbose: false });
  });

  test("-h/-help is ignored (does not throw)", () => {
    const result = parseCleanArgs(["-h"]);
    expect(result).toEqual({ force: false, all: false, dryRun: false, verbose: false });
  });

  test("-verbose flag", () => {
    const result = parseCleanArgs(["-verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v flag", () => {
    const result = parseCleanArgs(["-v"]);
    expect(result.verbose).toBe(true);
  });

  test("error: unknown option", () => {
    expect(() => parseCleanArgs(["-unknown"])).toThrow("Unknown option for clean command: -unknown");
  });
});

describe("parseListArgs", () => {
  test("basic - no options", () => {
    const result = parseListArgs([]);
    expect(result).toEqual({ json: false, verbose: false });
  });

  test("-json flag", () => {
    const result = parseListArgs(["-json"]);
    expect(result.json).toBe(true);
  });

  test("-j flag (alias for -json)", () => {
    const result = parseListArgs(["-j"]);
    expect(result.json).toBe(true);
  });

  test("-verbose flag", () => {
    const result = parseListArgs(["-verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v flag", () => {
    const result = parseListArgs(["-v"]);
    expect(result.verbose).toBe(true);
  });

  test("-json + -verbose", () => {
    const result = parseListArgs(["-json", "-verbose"]);
    expect(result).toEqual({ json: true, verbose: true });
  });

  test("-h/-help is ignored (does not throw)", () => {
    const result = parseListArgs(["-h"]);
    expect(result).toEqual({ json: false, verbose: false });
  });

  test("error: unknown option", () => {
    expect(() => parseListArgs(["-unknown"])).toThrow("Unknown option for list command: -unknown");
  });
});
