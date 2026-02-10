import { describe, expect, test } from "vitest";

import type { RunInPaneArgs } from "../types.ts";
import { parseRunInPaneArgs } from "./run-in-pane.ts";

function encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

const validArgs: RunInPaneArgs = {
  worktreePath: "/tmp/worktree",
  repoRoot: "/tmp/repo",
  claudeCommand: 'claude --prompt "hello"',
  postCreateCommand: "docker-compose up -d",
  postCreateTimeout: 300,
  preCleanCommand: "docker-compose down",
  preCleanTimeout: 120,
  postCleanCommand: "docker volume rm data",
  postCleanTimeout: 60,
  slot: 1,
  verbose: false,
};

describe("parseRunInPaneArgs", () => {
  test("valid payload - decodes all fields", () => {
    const result = parseRunInPaneArgs([encode(validArgs)]);
    expect(result).toEqual(validArgs);
  });

  test("valid payload - optional fields omitted", () => {
    const minimal = {
      worktreePath: "/tmp/worktree",
      repoRoot: "/tmp/repo",
      claudeCommand: "claude",
      postCreateTimeout: 600,
      preCleanTimeout: 600,
      postCleanTimeout: 600,
      verbose: true,
    };
    const result = parseRunInPaneArgs([encode(minimal)]);
    expect(result).toEqual({
      ...minimal,
      postCreateCommand: undefined,
      preCleanCommand: undefined,
      postCleanCommand: undefined,
      slot: undefined,
    });
  });

  test("error: wrong arg count (0 args)", () => {
    expect(() => parseRunInPaneArgs([])).toThrow("requires exactly one base64-encoded argument");
  });

  test("error: wrong arg count (2 args)", () => {
    expect(() => parseRunInPaneArgs(["a", "b"])).toThrow("requires exactly one base64-encoded argument");
  });

  test("error: invalid base64", () => {
    expect(() => parseRunInPaneArgs(["not-valid-base64!!!"])).toThrow("invalid JSON payload");
  });

  test("error: invalid JSON", () => {
    const badJson = Buffer.from("not json at all{").toString("base64");
    expect(() => parseRunInPaneArgs([badJson])).toThrow("invalid JSON payload");
  });

  test("error: missing worktreePath", () => {
    const { worktreePath: _, ...rest } = validArgs;
    expect(() => parseRunInPaneArgs([encode(rest)])).toThrow("missing required field 'worktreePath'");
  });

  test("error: missing repoRoot", () => {
    const { repoRoot: _, ...rest } = validArgs;
    expect(() => parseRunInPaneArgs([encode(rest)])).toThrow("missing required field 'repoRoot'");
  });

  test("error: missing claudeCommand", () => {
    const { claudeCommand: _, ...rest } = validArgs;
    expect(() => parseRunInPaneArgs([encode(rest)])).toThrow("missing required field 'claudeCommand'");
  });

  test("error: missing postCreateTimeout", () => {
    const { postCreateTimeout: _, ...rest } = validArgs;
    expect(() => parseRunInPaneArgs([encode(rest)])).toThrow(
      "'postCreateTimeout' must be a finite non-negative number",
    );
  });

  test("error: negative timeout", () => {
    expect(() => parseRunInPaneArgs([encode({ ...validArgs, postCreateTimeout: -1 })])).toThrow(
      "'postCreateTimeout' must be a finite non-negative number",
    );
  });

  test("error: NaN timeout", () => {
    // NaN is serialized as null in JSON, so it becomes a missing field
    expect(() => parseRunInPaneArgs([encode({ ...validArgs, preCleanTimeout: Number.NaN })])).toThrow(
      "'preCleanTimeout' must be a finite non-negative number",
    );
  });

  test("error: Infinity timeout", () => {
    // Infinity is serialized as null in JSON, so it becomes a missing field
    expect(() => parseRunInPaneArgs([encode({ ...validArgs, postCleanTimeout: Number.POSITIVE_INFINITY })])).toThrow(
      "'postCleanTimeout' must be a finite non-negative number",
    );
  });

  test("error: missing verbose", () => {
    const { verbose: _, ...rest } = validArgs;
    expect(() => parseRunInPaneArgs([encode(rest)])).toThrow("missing required field 'verbose'");
  });

  test.each([null, [], "string", 0, true])("error: non-object payload (%j)", (value) => {
    expect(() => parseRunInPaneArgs([encode(value)])).toThrow("payload must be a JSON object");
  });
});
