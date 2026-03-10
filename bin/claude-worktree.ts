#!/usr/bin/env node

import { parseArgs, run } from "../src/cli.ts";
import { ExitCode, getErrorMessage, toExitCode } from "../src/core/errors.ts";

async function main() {
  try {
    const command = parseArgs(process.argv.slice(2));
    await run(command);
  } catch (error) {
    const message = getErrorMessage(error);
    const code = toExitCode(error);
    console.error(code !== ExitCode.general ? message : `Error: ${message}`);
    process.exit(code);
  }
}

main();
