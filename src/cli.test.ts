import { describe, expect, test } from "bun:test";
import { parseArgs, parseCreateArgs, parseCleanArgs } from "./cli";

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

    test("--help flag - returns help", () => {
      const result = parseArgs(["--help"]);
      expect(result).toEqual({ type: "help" });
    });

    test("-h in the middle - returns help", () => {
      const result = parseArgs(["feature/test", "-h", "task"]);
      expect(result).toEqual({ type: "help" });
    });

    test("--help in the middle - returns help", () => {
      const result = parseArgs(["clean", "--help"]);
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

  describe("create", () => {
    test("branch + task - basic create", () => {
      const result = parseArgs(["feature/auth", "Implement Auth"]);
      expect(result).toEqual({
        type: "create",
        args: {
          branchName: "feature/auth",
          taskName: "Implement Auth",
          prompt: "Implement Auth",
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

    test("branch + task + inline prompt", () => {
      const result = parseArgs(["feature/auth", "Implement Auth", "Implement authentication feature"]);
      expect(result).toEqual({
        type: "create",
        args: {
          branchName: "feature/auth",
          taskName: "Implement Auth",
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
  test("basic - branch + task", () => {
    const result = parseCreateArgs(["feature/test", "Test Task"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Test Task",
      prompt: "Test Task",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("with inline prompt", () => {
    const result = parseCreateArgs(["fix/bug", "Fix Bug", "Fix this bug"]);
    expect(result).toEqual({
      branchName: "fix/bug",
      taskName: "Fix Bug",
      prompt: "Fix this bug",
      planFile: undefined,
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("--plan option", () => {
    const result = parseCreateArgs(["feature/api", "Implement API", "--plan", "./plan.md"]);
    expect(result).toEqual({
      branchName: "feature/api",
      taskName: "Implement API",
      prompt: "Implement API",
      planFile: "./plan.md",
      danger: false,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("--danger option", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--danger + --plan options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "--plan", "plan.md", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
      prompt: "Task",
      planFile: "plan.md",
      danger: true,
      merge: false,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("--merge option", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--merge + --danger options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--merge", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--merge + --plan options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "--plan", "plan.md", "--merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
      prompt: "Task",
      planFile: "plan.md",
      danger: false,
      merge: true,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("all options combined --merge + --danger + --plan", () => {
    const result = parseCreateArgs(["feature/test", "Task", "--plan", "plan.md", "--merge", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
      prompt: "Task",
      planFile: "plan.md",
      danger: true,
      merge: true,
      draft: false,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("--base option", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--base + --danger options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--base", "develop", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--base + --merge options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--base", "develop", "--merge"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--base + --plan options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "--base", "develop", "--plan", "plan.md"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
      prompt: "Task",
      planFile: "plan.md",
      danger: false,
      merge: false,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("all options combined --base + --merge + --danger + --plan", () => {
    const result = parseCreateArgs(["feature/test", "Task", "--base", "develop", "--plan", "plan.md", "--merge", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
      prompt: "Task",
      planFile: "plan.md",
      danger: true,
      merge: true,
      draft: false,
      baseBranch: "develop",
      pane: false,
      verbose: false,
    });
  });

  test("--draft option", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--draft"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--draft + --danger options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--draft", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--draft + --base options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--draft", "--base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--draft + --plan options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "--draft", "--plan", "plan.md"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
      prompt: "Task",
      planFile: "plan.md",
      danger: false,
      merge: false,
      draft: true,
      baseBranch: undefined,
      pane: false,
      verbose: false,
    });
  });

  test("--pane option", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--pane"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "-p"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--pane + --danger options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--pane", "--danger"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--pane + --draft + --base options", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--pane", "--draft", "--base", "develop"]);
    expect(result).toEqual({
      branchName: "feature/test",
      taskName: "Task",
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

  test("--verbose option", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "--verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v option", () => {
    const result = parseCreateArgs(["feature/test", "Task", "Prompt", "-v"]);
    expect(result.verbose).toBe(true);
  });

  test("-p does not become part of prompt", () => {
    const result = parseCreateArgs(["feature/test", "Task", "-p", "Prompt"]);
    expect(result.pane).toBe(true);
    expect(result.prompt).toBe("Prompt");
  });

  test("error: --merge and --draft are mutually exclusive", () => {
    expect(() => parseCreateArgs(["feature/test", "Task", "Prompt", "--merge", "--draft"])).toThrow(
      "Cannot use both --merge and --draft options"
    );
  });

  test("error: --base without argument", () => {
    expect(() => parseCreateArgs(["feature/test", "Task", "--base"])).toThrow(
      "--base requires a branch name argument"
    );
  });

  test("error: not enough arguments (0)", () => {
    expect(() => parseCreateArgs([])).toThrow("Usage:");
  });

  test("error: not enough arguments (1)", () => {
    expect(() => parseCreateArgs(["feature/test"])).toThrow("Usage:");
  });

  test("error: --plan without argument", () => {
    expect(() => parseCreateArgs(["feature/test", "Task", "--plan"])).toThrow(
      "--plan requires a file path argument"
    );
  });

  test("error: both --plan and inline prompt", () => {
    expect(() =>
      parseCreateArgs(["feature/test", "Task", "Prompt", "--plan", "plan.md"])
    ).toThrow("Cannot use both --plan and inline prompt");
  });

  test("multi-word inline prompt", () => {
    const result = parseCreateArgs(["feature/test", "Task", "this", "is", "multi-word"]);
    expect(result.prompt).toBe("this is multi-word");
  });

  test("error: unknown option --unknown", () => {
    expect(() => parseCreateArgs(["feature/test", "Task", "--unknown", "text"])).toThrow(
      "Unknown option: --unknown"
    );
  });

  test("error: unknown short option -x", () => {
    expect(() => parseCreateArgs(["feature/test", "Task", "-x"])).toThrow(
      "Unknown option: -x"
    );
  });

  test("error: unknown option after prompt", () => {
    expect(() => parseCreateArgs(["feature/test", "Task", "Prompt", "--foo"])).toThrow(
      "Unknown option: --foo"
    );
  });
});

describe("parseCleanArgs", () => {
  test("basic - no options", () => {
    const result = parseCleanArgs([]);
    expect(result).toEqual({ force: false, all: false, dryRun: false, verbose: false });
  });

  test("--force flag", () => {
    const result = parseCleanArgs(["--force"]);
    expect(result.force).toBe(true);
  });

  test("-f flag", () => {
    const result = parseCleanArgs(["-f"]);
    expect(result.force).toBe(true);
  });

  test("--all flag", () => {
    const result = parseCleanArgs(["--all"]);
    expect(result.all).toBe(true);
  });

  test("-a flag", () => {
    const result = parseCleanArgs(["-a"]);
    expect(result.all).toBe(true);
  });

  test("--dry-run flag", () => {
    const result = parseCleanArgs(["--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  test("-n flag", () => {
    const result = parseCleanArgs(["-n"]);
    expect(result.dryRun).toBe(true);
  });

  test("combined flags - --force --all --dry-run", () => {
    const result = parseCleanArgs(["--force", "--all", "--dry-run"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true, verbose: false });
  });

  test("combined short flags - -f -a -n", () => {
    const result = parseCleanArgs(["-f", "-a", "-n"]);
    expect(result).toEqual({ force: true, all: true, dryRun: true, verbose: false });
  });

  test("-h/--help is ignored (does not throw)", () => {
    const result = parseCleanArgs(["-h"]);
    expect(result).toEqual({ force: false, all: false, dryRun: false, verbose: false });
  });

  test("--verbose flag", () => {
    const result = parseCleanArgs(["--verbose"]);
    expect(result.verbose).toBe(true);
  });

  test("-v flag", () => {
    const result = parseCleanArgs(["-v"]);
    expect(result.verbose).toBe(true);
  });

  test("error: unknown option", () => {
    expect(() => parseCleanArgs(["--unknown"])).toThrow("Unknown option for clean command: --unknown");
  });
});
