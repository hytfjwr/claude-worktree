#!/usr/bin/env bun

import { parseArgs, run, showHelp, type ParseResult } from "../src/cli";

function isHelpRequest(result: ParseResult): result is { type: "help" } {
  return "type" in result && result.type === "help";
}

async function main() {
  try {
    const result = parseArgs(process.argv.slice(2));

    if (isHelpRequest(result)) {
      showHelp();
      process.exit(0);
    }

    await run(result);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
