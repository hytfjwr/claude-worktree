import { describe, expect, test, vi } from "vitest";

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
  });

  describe("clean", () => {
    test("clean command", () => {
      const result = parseArgs(["clean"]);
      expect(result).toEqual({
        type: "clean",
        args: { force: false, all: false, dryRun: false, quiet: false, verbose: false, branches: [] },
      });
    });
  });

  describe("list", () => {
    test("list command", () => {
      const result = parseArgs(["list"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, quiet: false, verbose: false, noStatus: false, fetch: false },
      });
    });

    test("list -json", () => {
      const result = parseArgs(["list", "-json"]);
      expect(result).toEqual({
        type: "list",
        args: { json: true, quiet: false, verbose: false, noStatus: false, fetch: false },
      });
    });

    test("list -verbose", () => {
      const result = parseArgs(["list", "-verbose"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, quiet: false, verbose: true, noStatus: false, fetch: false },
      });
    });

    test("list -v", () => {
      const result = parseArgs(["list", "-v"]);
      expect(result).toEqual({
        type: "list",
        args: { json: false, quiet: false, verbose: true, noStatus: false, fetch: false },
      });
    });

    test("list -json -verbose", () => {
      const result = parseArgs(["list", "-json", "-verbose"]);
      expect(result).toEqual({
        type: "list",
        args: { json: true, quiet: false, verbose: true, noStatus: false, fetch: false },
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
          pr: false,
          pull: false,
          baseBranch: undefined,
          pane: false,
          quiet: false,
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
    test.each(["ABC", "status", "hotfix"])('single word "%s" throws missing prompt error', (input) => {
      expect(() => parseArgs([input])).toThrow(`Missing prompt for branch "${input}"`);
    });

    test.each([
      "claude-worktree ABC '<prompt>'",
      "claude-worktree ABC -plan <file-path>",
    ])('error message includes "%s"', (substring) => {
      expect(() => parseArgs(["ABC"])).toThrow(substring);
    });

    test("non-subcommand word falls through to create", () => {
      // parseSubCommand returns null for unknown words, falling through to create
      const result = parseArgs(["hotfix", "Fix the bug"]);
      expect(result.type).toBe("create");
    });

    test("branch with -plan falls through to create", () => {
      const result = parseArgs(["hotfix", "-plan", "plan.md"]);
      expect(result.type).toBe("create");
    });
  });
});

describe("parseCreateArgs", () => {
  test("branch + prompt", () => {
    const result = parseCreateArgs(["feature/test", "Test prompt"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "Test prompt",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      pr: false,
      pull: false,
      baseBranch: undefined,
      pane: false,
      quiet: false,
      verbose: false,
      dryRun: false,
    });
  });

  test("-plan option", () => {
    const result = parseCreateArgs(["feature/api", "-plan", "./plan.md"]);
    expect(result.planFile).toBe("./plan.md");
    expect(result.prompt).toBe("");
  });

  test("-danger option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-danger"]);
    expect(result.danger).toBe(true);
  });

  test("-d option (alias for -danger)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-d"]);
    expect(result.danger).toBe(true);
  });

  test("-danger + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-plan", "plan.md", "-danger"]);
    expect(result.danger).toBe(true);
    expect(result.planFile).toBe("plan.md");
  });

  test("-merge option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-merge"]);
    expect(result.merge).toBe(true);
  });

  test("-m option (alias for -merge)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-m"]);
    expect(result.merge).toBe(true);
  });

  test("-merge + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-merge", "-danger"]);
    expect(result.merge).toBe(true);
    expect(result.danger).toBe(true);
  });

  test("-merge + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-plan", "plan.md", "-merge"]);
    expect(result.merge).toBe(true);
    expect(result.planFile).toBe("plan.md");
  });

  test("all options combined -pane -draft -pull -danger -verbose -dry-run -plan", () => {
    const result = parseCreateArgs([
      "feature/test",
      "-plan",
      "plan.md",
      "-pane",
      "-draft",
      "-pull",
      "-danger",
      "-verbose",
      "-dry-run",
    ]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: true,
      merge: false,
      draft: true,
      pr: false,
      pull: true,
      baseBranch: undefined,
      pane: true,
      quiet: false,
      verbose: true,
      dryRun: true,
    });
  });

  test("-base option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-base", "develop"]);
    expect(result.baseBranch).toBe("develop");
  });

  test("-b option (alias for -base)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-b", "develop"]);
    expect(result.baseBranch).toBe("develop");
  });

  test("-base + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-base", "develop", "-danger"]);
    expect(result.baseBranch).toBe("develop");
    expect(result.danger).toBe(true);
  });

  test("-base + -merge options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-base", "develop", "-merge"]);
    expect(result.baseBranch).toBe("develop");
    expect(result.merge).toBe(true);
  });

  test("-base + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-base", "develop", "-plan", "plan.md"]);
    expect(result.baseBranch).toBe("develop");
    expect(result.planFile).toBe("plan.md");
  });

  test("all options combined -base -pane -draft -pull -danger -verbose -dry-run -plan", () => {
    const result = parseCreateArgs([
      "feature/test",
      "-base",
      "develop",
      "-plan",
      "plan.md",
      "-pane",
      "-draft",
      "-pull",
      "-danger",
      "-verbose",
      "-dry-run",
    ]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "",
      planFile: "plan.md",
      danger: true,
      merge: false,
      draft: true,
      pr: false,
      pull: true,
      baseBranch: "develop",
      pane: true,
      quiet: false,
      verbose: true,
      dryRun: true,
    });
  });

  test("-draft option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-draft"]);
    expect(result.draft).toBe(true);
  });

  test("-draft + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-draft", "-danger"]);
    expect(result.draft).toBe(true);
    expect(result.danger).toBe(true);
  });

  test("-draft + -base options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-draft", "-base", "develop"]);
    expect(result.draft).toBe(true);
    expect(result.baseBranch).toBe("develop");
  });

  test("-draft + -plan options", () => {
    const result = parseCreateArgs(["feature/test", "-draft", "-plan", "plan.md"]);
    expect(result.draft).toBe(true);
    expect(result.planFile).toBe("plan.md");
  });

  test("-pane option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pane"]);
    expect(result.pane).toBe(true);
  });

  test("-p option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-p"]);
    expect(result.pane).toBe(true);
  });

  test("-pane + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pane", "-danger"]);
    expect(result.pane).toBe(true);
    expect(result.danger).toBe(true);
  });

  test("-pane + -draft + -base options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pane", "-draft", "-base", "develop"]);
    expect(result.pane).toBe(true);
    expect(result.draft).toBe(true);
    expect(result.baseBranch).toBe("develop");
  });

  test("-pull option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pull"]);
    expect(result.pull).toBe(true);
  });

  test("-pull + -base options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pull", "-base", "main"]);
    expect(result.pull).toBe(true);
    expect(result.baseBranch).toBe("main");
  });

  test("-pull + -verbose options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pull", "-verbose"]);
    expect(result.pull).toBe(true);
    expect(result.verbose).toBe(true);
  });

  test("-pull + -dry-run options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pull", "-dry-run"]);
    expect(result.pull).toBe(true);
    expect(result.dryRun).toBe(true);
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

  test("-quiet option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-quiet"]);
    expect(result.quiet).toBe(true);
  });

  test("-q option (alias for -quiet)", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-q"]);
    expect(result.quiet).toBe(true);
  });

  test("-p does not become part of prompt", () => {
    const result = parseCreateArgs(["feature/test", "-p", "Prompt"]);
    expect(result.pane).toBe(true);
    expect(result.prompt).toBe("Prompt");
  });

  test("-pr option", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pr"]);
    expect(result.pr).toBe(true);
  });

  test("-pr + -base options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pr", "-base", "develop"]);
    expect(result.pr).toBe(true);
    expect(result.baseBranch).toBe("develop");
  });

  test("-pr + -danger options", () => {
    const result = parseCreateArgs(["feature/test", "Prompt", "-pr", "-danger"]);
    expect(result.pr).toBe(true);
    expect(result.danger).toBe(true);
  });

  test("-merge + -draft throws mutually exclusive error", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-merge", "-draft"])).toThrow(
      "Cannot use both -merge and -draft options",
    );
  });

  test("-merge + -pr throws mutually exclusive error", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-merge", "-pr"])).toThrow(
      "Cannot use both -merge and -pr options",
    );
  });

  test("-draft + -pr throws mutually exclusive error", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-draft", "-pr"])).toThrow(
      "Cannot use both -draft and -pr options",
    );
  });

  test("-base without argument throws", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-base"])).toThrow("-base requires a branch name argument");
  });

  test("no arguments throws usage error", () => {
    expect(() => parseCreateArgs([])).toThrow("Usage:");
  });

  test("no prompt and no -plan throws", () => {
    expect(() => parseCreateArgs(["feature/test"])).toThrow("A prompt or -plan option is required");
  });

  test("-plan without argument throws", () => {
    expect(() => parseCreateArgs(["feature/test", "-plan"])).toThrow("-plan requires a file path argument");
  });

  test("-plan + inline prompt throws", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-plan", "plan.md"])).toThrow(
      "Cannot use both -plan and inline prompt",
    );
  });

  test("-plan with empty string throws", () => {
    expect(() => parseCreateArgs(["feature/test", "-plan", ""])).toThrow("A prompt or -plan option is required");
  });

  test("multi-word inline prompt", () => {
    const result = parseCreateArgs(["feature/test", "this", "is", "multi-word"]);
    expect(result.prompt).toBe("this is multi-word");
  });

  test("unknown option -unknown throws", () => {
    expect(() => parseCreateArgs(["feature/test", "-unknown", "text"])).toThrow("Unknown option: -unknown");
  });

  test("unknown option -x throws", () => {
    expect(() => parseCreateArgs(["feature/test", "-x"])).toThrow("Unknown option: -x");
  });

  test("unknown option after prompt throws", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-foo"])).toThrow("Unknown option: -foo");
  });

  test("--pane suggests -pane", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "--pane"])).toThrow(
      'Unknown option: "--pane" (did you mean "-pane"?)',
    );
  });

  test("--base suggests -base", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "--base", "develop"])).toThrow(
      'Unknown option: "--base" (did you mean "-base"?)',
    );
  });
});

describe("parseCleanArgs", () => {
  test("no options", () => {
    const result = parseCleanArgs([]);
    expect(result).toEqual({ force: false, all: false, dryRun: false, quiet: false, verbose: false, branches: [] });
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

  test("combined flags -force -all -dry-run -verbose", () => {
    const result = parseCleanArgs(["-force", "-all", "-dry-run", "-verbose"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true, quiet: false, verbose: true, branches: [] });
  });

  test("combined short flags -f -a -n -v", () => {
    const result = parseCleanArgs(["-f", "-a", "-n", "-v"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true, quiet: false, verbose: true, branches: [] });
  });

  test("-h/-help is ignored (does not throw)", () => {
    const result = parseCleanArgs(["-h"]);
    expect(result).toEqual({ force: false, all: false, dryRun: false, quiet: false, verbose: false, branches: [] });
  });

  test("-verbose flag", () => {
    const result = parseCleanArgs(["-verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v flag", () => {
    const result = parseCleanArgs(["-v"]);
    expect(result.verbose).toBe(true);
  });

  test("-quiet flag", () => {
    const result = parseCleanArgs(["-quiet"]);
    expect(result.quiet).toBe(true);
  });

  test("-q flag (alias for -quiet)", () => {
    const result = parseCleanArgs(["-q"]);
    expect(result.quiet).toBe(true);
  });

  test("unknown option throws", () => {
    expect(() => parseCleanArgs(["-unknown"])).toThrow("Unknown option for clean command: -unknown");
  });

  test("--force suggests -force", () => {
    expect(() => parseCleanArgs(["--force"])).toThrow(
      'Unknown option for clean command: "--force" (did you mean "-force"?)',
    );
  });

  test("single branch name", () => {
    const result = parseCleanArgs(["feature/auth"]);
    expect(result).toEqual({
      force: false,
      all: false,
      dryRun: false,
      quiet: false,
      verbose: false,
      branches: ["feature/auth"],
    });
  });

  test("multiple branch names", () => {
    const result = parseCleanArgs(["feature/auth", "fix/bug-123"]);
    expect(result.branches).toEqual(["feature/auth", "fix/bug-123"]);
  });

  test("branch names with flags", () => {
    const result = parseCleanArgs(["feature/auth", "-force", "fix/bug-123"]);
    expect(result.force).toBe(true);
    expect(result.branches).toEqual(["feature/auth", "fix/bug-123"]);
  });

  test("branch names + -dry-run", () => {
    const result = parseCleanArgs(["feature/auth", "-dry-run"]);
    expect(result.dryRun).toBe(true);
    expect(result.branches).toEqual(["feature/auth"]);
  });

  test("branch names + -all throws", () => {
    expect(() => parseCleanArgs(["feature/auth", "-all"])).toThrow("Cannot use both branch names and -all option");
  });
});

describe("parseListArgs", () => {
  test("no options", () => {
    const result = parseListArgs([]);
    expect(result).toEqual({ json: false, quiet: false, verbose: false, noStatus: false, fetch: false });
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

  test("-status throws as unknown option", () => {
    expect(() => parseListArgs(["-status"])).toThrow("Unknown option for list command");
  });

  test("-s throws as unknown option", () => {
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

  test("-quiet flag", () => {
    const result = parseListArgs(["-quiet"]);
    expect(result.quiet).toBe(true);
  });

  test("-q flag (alias for -quiet)", () => {
    const result = parseListArgs(["-q"]);
    expect(result.quiet).toBe(true);
  });

  test("-fetch flag", () => {
    const result = parseListArgs(["-fetch"]);
    expect(result.fetch).toBe(true);
  });

  test("-json + -verbose", () => {
    const result = parseListArgs(["-json", "-verbose"]);
    expect(result).toEqual({ json: true, quiet: false, verbose: true, noStatus: false, fetch: false });
  });

  test("-no-status + -json", () => {
    const result = parseListArgs(["-no-status", "-json"]);
    expect(result).toEqual({ json: true, quiet: false, verbose: false, noStatus: true, fetch: false });
  });

  test("-no-status + -v", () => {
    const result = parseListArgs(["-no-status", "-v"]);
    expect(result).toEqual({ json: false, quiet: false, verbose: true, noStatus: true, fetch: false });
  });

  test("-h/-help is ignored (does not throw)", () => {
    const result = parseListArgs(["-h"]);
    expect(result).toEqual({ json: false, quiet: false, verbose: false, noStatus: false, fetch: false });
  });

  test("unknown option throws", () => {
    expect(() => parseListArgs(["-unknown"])).toThrow("Unknown option for list command: -unknown");
  });

  test("--json suggests -json", () => {
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
  test("branch name starting with - throws", () => {
    expect(() => parseCreateArgs(["-feature", "Prompt"])).toThrow("cannot start with");
  });

  test("branch name with spaces throws", () => {
    expect(() => parseCreateArgs(["my branch", "Prompt"])).toThrow("whitespace");
  });

  test("-base with invalid branch name throws", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-base", "my branch"])).toThrow("Invalid base branch name");
  });

  test("-base with '..' in name throws", () => {
    expect(() => parseCreateArgs(["feature/test", "Prompt", "-base", "a..b"])).toThrow("Invalid base branch name");
  });
});

describe("parseCreateArgs - whitespace prompt", () => {
  test("whitespace-only prompt throws", () => {
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

  test("clean -help returns clean help", () => {
    const result = parseArgs(["clean", "-help"]);
    expect(result).toEqual({ type: "help", commandHelp: "clean" });
  });

  test("branch -h returns create help", () => {
    const result = parseArgs(["feature/test", "-h"]);
    expect(result).toEqual({ type: "help", commandHelp: "create" });
  });

  test("branch -help returns create help", () => {
    const result = parseArgs(["feature/test", "-help"]);
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
        quiet: false,
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
        quiet: false,
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
        quiet: false,
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
        quiet: false,
        verbose: false,
      },
    });
  });
});

// ============================================================================
// parseResumeArgs
// ============================================================================

describe("parseResumeArgs", () => {
  test("no args", () => {
    const result = parseResumeArgs([]);
    expect(result).toEqual({
      branchName: undefined,
      prompt: undefined,
      danger: false,
      pane: false,
      quiet: false,
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
      quiet: false,
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
      quiet: false,
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

  test("-quiet option", () => {
    const result = parseResumeArgs(["feature/test", "-quiet"]);
    expect(result.quiet).toBe(true);
  });

  test("-q option (alias for -quiet)", () => {
    const result = parseResumeArgs(["feature/test", "-q"]);
    expect(result.quiet).toBe(true);
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
      quiet: false,
      verbose: true,
    });
  });

  test("prompt with interleaved -v option extracts verbose and joins remaining words", () => {
    const result = parseResumeArgs(["feature/test", "fix", "-v", "the", "bug"]);
    expect(result).toEqual({
      branchName: "feature/test",
      prompt: "fix the bug",
      pane: false,
      danger: false,
      quiet: false,
      verbose: true,
    });
  });

  test("unknown option throws", () => {
    expect(() => parseResumeArgs(["-unknown"])).toThrow("Unknown option for resume command: -unknown");
  });

  test("--pane suggests -pane", () => {
    expect(() => parseResumeArgs(["--pane"])).toThrow(
      'Unknown option for resume command: "--pane" (did you mean "-pane"?)',
    );
  });

  test("-h is ignored (does not throw)", () => {
    const result = parseResumeArgs(["-h"]);
    expect(result.branchName).toBeUndefined();
  });
});

// ============================================================================
// run() dispatcher
// ============================================================================

vi.mock("./commands/create.ts", () => ({
  runCreate: vi.fn(),
}));

vi.mock("./commands/resume.ts", () => ({
  runResume: vi.fn(),
}));

vi.mock("./commands/list.ts", () => ({
  executeList: vi.fn(),
}));

vi.mock("./commands/clean.ts", () => ({
  executeClean: vi.fn(),
}));

vi.mock("./commands/run-in-pane.ts", () => ({
  parseRunInPaneArgs: vi.fn(),
  executeRunInPane: vi.fn(),
}));

vi.mock("./ui/logger.ts", () => ({
  logInfo: vi.fn(),
  setLogger: vi.fn(),
  createQuietLogger: vi.fn(() => ({})),
}));

vi.mock("./ui/spinner.ts", () => ({
  setQuietMode: vi.fn(),
}));

vi.mock("./version.ts", () => ({
  getVersion: vi.fn(() => "1.2.3"),
}));

const { run } = await import("./cli.ts");
const { logInfo, setLogger, createQuietLogger } = await import("./ui/logger.ts");
const { setQuietMode } = await import("./ui/spinner.ts");

describe("run", () => {
  test("shows version for 'version' command", async () => {
    await run({ type: "version" });
    expect(logInfo).toHaveBeenCalledWith("1.2.3");
  });

  test("shows global help for 'help' command without commandHelp", async () => {
    await run({ type: "help" });
    expect(logInfo).toHaveBeenCalled();
    const output = vi.mocked(logInfo).mock.calls[0][0];
    expect(output).toContain("claude-worktree");
    expect(output).toContain("Usage:");
  });

  test("shows create help for 'help' command with commandHelp='create'", async () => {
    await run({ type: "help", commandHelp: "create" });
    expect(logInfo).toHaveBeenCalled();
    const output = vi.mocked(logInfo).mock.calls[0][0];
    expect(output).toContain("Create a new worktree");
  });

  test("shows list help for 'help' command with commandHelp='list'", async () => {
    await run({ type: "help", commandHelp: "list" });
    expect(logInfo).toHaveBeenCalled();
    const output = vi.mocked(logInfo).mock.calls[0][0];
    expect(output).toContain("List existing worktrees");
  });

  test("shows clean help for 'help' command with commandHelp='clean'", async () => {
    await run({ type: "help", commandHelp: "clean" });
    expect(logInfo).toHaveBeenCalled();
    const output = vi.mocked(logInfo).mock.calls[0][0];
    expect(output).toContain("Remove unnecessary worktrees");
  });

  test("shows resume help for 'help' command with commandHelp='resume'", async () => {
    await run({ type: "help", commandHelp: "resume" });
    expect(logInfo).toHaveBeenCalled();
    const output = vi.mocked(logInfo).mock.calls[0][0];
    expect(output).toContain("Resume a Claude session");
  });

  test("enables quiet mode when quiet flag is set", async () => {
    vi.mocked(createQuietLogger).mockClear();
    const args = { json: false, verbose: false, noStatus: false, quiet: true, fetch: false };
    await run({ type: "list", args });
    expect(createQuietLogger).toHaveBeenCalledOnce();
    expect(setLogger).toHaveBeenCalledWith(vi.mocked(createQuietLogger).mock.results[0].value);
    expect(setQuietMode).toHaveBeenCalledWith(true);
  });

  test("does not enable quiet mode when quiet flag is false", async () => {
    vi.mocked(setLogger).mockClear();
    vi.mocked(setQuietMode).mockClear();
    const args = { json: false, verbose: false, noStatus: false, quiet: false, fetch: false };
    await run({ type: "list", args });
    expect(setLogger).not.toHaveBeenCalled();
    expect(setQuietMode).not.toHaveBeenCalled();
  });
});
