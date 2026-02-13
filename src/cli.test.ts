import { describe, expect, test } from "vitest";

import {
  parseArgs,
  parseCleanArgs,
  parseCreateArgs,
  parseListArgs,
  parseResumeArgs,
  validateBranchName,
} from "./cli.ts";

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

    test("-h in the middle - returns create help", () => {
      const result = parseArgs(["feature/test", "-h", "prompt"]);
      expect(result).toEqual({ type: "help", commandHelp: "create" });
    });

    test("-help for clean - returns clean help", () => {
      const result = parseArgs(["clean", "-help"]);
      expect(result).toEqual({ type: "help", commandHelp: "clean" });
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
        args: { json: false, verbose: false, noStatus: false },
      });
    });

    test("list -json", () => {
      const result = parseArgs(["list", "-json"]);
      expect(result).toEqual({
        type: "list",
        args: { json: true, verbose: false, noStatus: false },
      });
    });

    test("list -verbose", () => {
      const result = parseArgs(["list", "-verbose"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, verbose: true, noStatus: false },
      });
    });

    test("list -v", () => {
      const result = parseArgs(["list", "-v"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, verbose: true, noStatus: false },
      });
    });

    test("list -json -verbose", () => {
      const result = parseArgs(["list", "-json", "-verbose"]);
      expect(result).toEqual({
        type: "list",
        args: { json: true, verbose: true, noStatus: false },
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
          pull: false,
          baseBranch: undefined,
          pane: false,
          verbose: false,
          dryRun: false,
        },
      });
    });
  });

  describe("_run-in-pane", () => {
    test("valid payload path - routes to _run-in-pane", () => {
      const result = parseArgs(["_run-in-pane", "/tmp/payload.json"]);
      expect(result).toEqual({ type: "_run-in-pane", payloadPath: "/tmp/payload.json" });
    });

    test("without payload path - throws", () => {
      expect(() => parseArgs(["_run-in-pane"])).toThrow("requires exactly one payload file path argument");
    });

    test("too many args - throws", () => {
      expect(() => parseArgs(["_run-in-pane", "/tmp/a.json", "extra"])).toThrow(
        "requires exactly one payload file path argument",
      );
    });

    test("checked before help flags - not treated as help", () => {
      // _run-in-pane is checked before help/-h and before the unknown-command guard
      const result = parseArgs(["_run-in-pane", "/tmp/payload.json"]);
      expect(result.type).toBe("_run-in-pane");
    });
  });

  describe("version", () => {
    test("-version flag - returns version", () => {
      const result = parseArgs(["-version"]);
      expect(result).toEqual({ type: "version" });
    });

    test("--version flag - returns version", () => {
      const result = parseArgs(["--version"]);
      expect(result).toEqual({ type: "version" });
    });

    test("-version is not matched when combined with other args", () => {
      // -version only works as the sole argument to avoid false positives on positional args
      expect(() => parseArgs(["feature/test", "-version"])).toThrow("Unknown option");
    });
  });

  describe("missing prompt for branch", () => {
    test.each(["ABC", "status", "hotfix"])('single word "%s" - throws missing prompt error', (input) => {
      expect(() => parseArgs([input])).toThrow(`Missing prompt for branch "${input}"`);
    });

    test.each([
      "claude-worktree ABC '<prompt>'",
      "claude-worktree ABC -plan <file-path>",
    ])('error message includes "%s"', (substring) => {
      expect(() => parseArgs(["ABC"])).toThrow(substring);
    });

    test("branch with prompt - does not throw unknown command", () => {
      const result = parseArgs(["hotfix", "Fix the bug"]);
      expect(result.type).toBe("create");
    });

    test("branch with -plan - does not throw unknown command", () => {
      const result = parseArgs(["hotfix", "-plan", "plan.md"]);
      expect(result.type).toBe("create");
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: undefined,
      pane: true,
      verbose: false,
      dryRun: false,
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
      pull: false,
      baseBranch: "develop",
      pane: true,
      verbose: false,
      dryRun: false,
    });
  });

  test("-pull option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pull"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      pull: true,
      baseBranch: undefined,
      pane: false,
      verbose: false,
      dryRun: false,
    });
  });

  test("-pull + -base options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pull", "-base", "main"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      pull: true,
      baseBranch: "main",
      pane: false,
      verbose: false,
      dryRun: false,
    });
  });

  test("-dry-run option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  test("-n option (alias for -dry-run)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-n"]);
    expect(result.dryRun).toBe(true);
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

  test("error: --pane → hint suggesting -pane", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "--pane"])).toThrow(
      'Unknown option: "--pane" (did you mean "-pane"?)',
    );
  });

  test("error: --base → hint suggesting -base", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "--base", "develop"])).toThrow(
      'Unknown option: "--base" (did you mean "-base"?)',
    );
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

  test("error: --force → hint suggesting -force", () => {
    expect(() => parseCleanArgs(["--force"])).toThrow(
      'Unknown option for clean command: "--force" (did you mean "-force"?)',
    );
  });
});

describe("parseListArgs", () => {
  test("basic - no options", () => {
    const result = parseListArgs([]);
    expect(result).toEqual({ json: false, verbose: false, noStatus: false });
  });

  test("-json flag", () => {
    const result = parseListArgs(["-json"]);
    expect(result.json).toBe(true);
  });

  test("-j flag (alias for -json)", () => {
    const result = parseListArgs(["-j"]);
    expect(result.json).toBe(true);
  });

  test("-no-status flag", () => {
    const result = parseListArgs(["-no-status"]);
    expect(result.noStatus).toBe(true);
  });

  test("-status is now unknown option", () => {
    expect(() => parseListArgs(["-status"])).toThrow("Unknown option for list command");
  });

  test("-s is now unknown option", () => {
    expect(() => parseListArgs(["-s"])).toThrow("Unknown option for list command");
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
    expect(result).toEqual({ json: true, verbose: true, noStatus: false });
  });

  test("-no-status + -json", () => {
    const result = parseListArgs(["-no-status", "-json"]);
    expect(result).toEqual({ json: true, verbose: false, noStatus: true });
  });

  test("-no-status + -v", () => {
    const result = parseListArgs(["-no-status", "-v"]);
    expect(result).toEqual({ json: false, verbose: true, noStatus: true });
  });

  test("-h/-help is ignored (does not throw)", () => {
    const result = parseListArgs(["-h"]);
    expect(result).toEqual({ json: false, verbose: false, noStatus: false });
  });

  test("error: unknown option", () => {
    expect(() => parseListArgs(["-unknown"])).toThrow("Unknown option for list command: -unknown");
  });

  test("error: --json → hint suggesting -json", () => {
    expect(() => parseListArgs(["--json"])).toThrow(
      'Unknown option for list command: "--json" (did you mean "-json"?)',
    );
  });
});

describe("validateBranchName", () => {
  test("valid branch names return null", () => {
    expect(validateBranchName("feature/auth")).toBeNull();
    expect(validateBranchName("fix/bug-123")).toBeNull();
    expect(validateBranchName("main")).toBeNull();
    expect(validateBranchName("feature/deep/nested")).toBeNull();
  });

  test("starting with - is invalid", () => {
    const result = validateBranchName("-invalid");
    expect(result).toContain("cannot start with");
  });

  test("starting with . is invalid", () => {
    const result = validateBranchName(".hidden");
    expect(result).toContain("cannot start or end with");
  });

  test("ending with . is invalid", () => {
    const result = validateBranchName("branch.");
    expect(result).toContain("cannot start or end with");
  });

  test("path component starting with . is invalid", () => {
    const result = validateBranchName("feature/.hidden");
    expect(result).toContain("Path components cannot start with");
  });

  test("ending with .lock is invalid", () => {
    const result = validateBranchName("branch.lock");
    expect(result).toContain(".lock");
  });

  test("containing .. is invalid", () => {
    const result = validateBranchName("a..b");
    expect(result).toContain("..");
  });

  test("containing // is invalid", () => {
    const result = validateBranchName("a//b");
    expect(result).toContain("consecutive slashes");
  });

  test("ending with / is invalid", () => {
    const result = validateBranchName("branch/");
    expect(result).toContain('end with "/"');
  });

  test("containing @{ is invalid", () => {
    const result = validateBranchName("branch@{0}");
    expect(result).toContain("@{");
  });

  test("@ alone is invalid", () => {
    const result = validateBranchName("@");
    expect(result).toContain('"@"');
  });

  test("containing backslash is invalid", () => {
    const result = validateBranchName("a\\b");
    expect(result).toContain("backslash");
  });

  test("containing space is invalid", () => {
    const result = validateBranchName("branch name");
    expect(result).toContain("whitespace");
  });

  test("containing ~ is invalid", () => {
    const result = validateBranchName("branch~1");
    expect(result).toContain('"~"');
  });

  test("containing ^ is invalid", () => {
    const result = validateBranchName("branch^2");
    expect(result).toContain('"^"');
  });

  test("containing : is invalid", () => {
    const result = validateBranchName("branch:name");
    expect(result).toContain('":"');
  });

  test("containing * is invalid", () => {
    const result = validateBranchName("branch*");
    expect(result).toContain('"*"');
  });

  test("containing ? is invalid", () => {
    const result = validateBranchName("branch?");
    expect(result).toContain('"?"');
  });

  test("containing [ is invalid", () => {
    const result = validateBranchName("branch[0]");
    expect(result).toContain('"["');
  });
});

describe("parseCreateArgs - branch validation", () => {
  test("error: branch name starting with -", () => {
    expect(() => parseCreateArgs(["-feature", "Prompt"])).toThrow("cannot start with");
  });

  test("error: branch name with spaces", () => {
    expect(() => parseCreateArgs(["my branch", "Prompt"])).toThrow("whitespace");
  });
});

describe("parseCreateArgs - whitespace prompt", () => {
  test("error: whitespace-only prompt is rejected", () => {
    expect(() => parseCreateArgs(["feature/test", "   "])).toThrow("A prompt or -plan option is required");
  });
});

describe("parseArgs - per-command help", () => {
  test("list -h returns list help", () => {
    const result = parseArgs(["list", "-h"]);
    expect(result).toEqual({ type: "help", commandHelp: "list" });
  });

  test("list -help returns list help", () => {
    const result = parseArgs(["list", "-help"]);
    expect(result).toEqual({ type: "help", commandHelp: "list" });
  });

  test("clean -h returns clean help", () => {
    const result = parseArgs(["clean", "-h"]);
    expect(result).toEqual({ type: "help", commandHelp: "clean" });
  });

  test("branch -h returns create help", () => {
    const result = parseArgs(["feature/test", "-h"]);
    expect(result).toEqual({ type: "help", commandHelp: "create" });
  });

  test("bare -h returns global help", () => {
    const result = parseArgs(["-h"]);
    expect(result).toEqual({ type: "help" });
  });

  test("resume -h returns resume help", () => {
    const result = parseArgs(["resume", "-h"]);
    expect(result).toEqual({ type: "help", commandHelp: "resume" });
  });

  test("resume -help returns resume help", () => {
    const result = parseArgs(["resume", "-help"]);
    expect(result).toEqual({ type: "help", commandHelp: "resume" });
  });
});

// ============================================================================
// parseArgs - resume routing
// ============================================================================

describe("parseArgs - resume", () => {
  test("resume with no args", () => {
    const result = parseArgs(["resume"]);
    expect(result).toEqual({
      type: "resume",
      args: {
        branchName: undefined,
        prompt: undefined,
        danger: false,
        pane: false,
        verbose: false,
      },
    });
  });

  test("resume with branch name", () => {
    const result = parseArgs(["resume", "feature/auth"]);
    expect(result).toEqual({
      type: "resume",
      args: {
        branchName: "feature/auth",
        prompt: undefined,
        danger: false,
        pane: false,
        verbose: false,
      },
    });
  });

  test("resume with branch name and prompt", () => {
    const result = parseArgs(["resume", "feature/auth", "Continue work"]);
    expect(result).toEqual({
      type: "resume",
      args: {
        branchName: "feature/auth",
        prompt: "Continue work",
        danger: false,
        pane: false,
        verbose: false,
      },
    });
  });

  test("resume with options", () => {
    const result = parseArgs(["resume", "feature/auth", "-pane", "-danger"]);
    expect(result).toEqual({
      type: "resume",
      args: {
        branchName: "feature/auth",
        prompt: undefined,
        danger: true,
        pane: true,
        verbose: false,
      },
    });
  });
});

// ============================================================================
// parseResumeArgs
// ============================================================================

describe("parseResumeArgs", () => {
  test("no args - all undefined/false", () => {
    const result = parseResumeArgs([]);
    expect(result).toEqual({
      branchName: undefined,
      prompt: undefined,
      danger: false,
      pane: false,
      verbose: false,
    });
  });

  test("branch name only", () => {
    const result = parseResumeArgs(["feature/test"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: undefined,
      danger: false,
      pane: false,
      verbose: false,
    });
  });

  test("branch name + prompt", () => {
    const result = parseResumeArgs(["feature/test", "Continue the work"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Continue the work",
      danger: false,
      pane: false,
      verbose: false,
    });
  });

  test("multi-word prompt", () => {
    const result = parseResumeArgs(["feature/test", "fix", "the", "bug"]);
    expect(result.prompt).toBe("fix the bug");
  });

  test("-pane option", () => {
    const result = parseResumeArgs(["feature/test", "-pane"]);
    expect(result.pane).toBe(true);
  });

  test("-p option", () => {
    const result = parseResumeArgs(["-p", "feature/test"]);
    expect(result.pane).toBe(true);
    expect(result.branchName).toBe("feature/test");
  });

  test("-danger option", () => {
    const result = parseResumeArgs(["feature/test", "-danger"]);
    expect(result.danger).toBe(true);
  });

  test("-d option", () => {
    const result = parseResumeArgs(["feature/test", "-d"]);
    expect(result.danger).toBe(true);
  });

  test("-verbose option", () => {
    const result = parseResumeArgs(["feature/test", "-verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v option", () => {
    const result = parseResumeArgs(["feature/test", "-v"]);
    expect(result.verbose).toBe(true);
  });

  test("all options combined", () => {
    const result = parseResumeArgs(["feature/test", "prompt", "-p", "-d", "-v"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "prompt",
      pane: true,
      danger: true,
      verbose: true,
    });
  });

  test("error: unknown option", () => {
    expect(() => parseResumeArgs(["-unknown"])).toThrow("Unknown option for resume command: -unknown");
  });

  test("error: --pane → hint suggesting -pane", () => {
    expect(() => parseResumeArgs(["--pane"])).toThrow(
      'Unknown option for resume command: "--pane" (did you mean "-pane"?)',
    );
  });

  test("-h is ignored (does not throw)", () => {
    const result = parseResumeArgs(["-h"]);
    expect(result.branchName).toBeUndefined();
  });
});
