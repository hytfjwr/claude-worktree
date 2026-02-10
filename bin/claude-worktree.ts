#!/usr/bin/env node

import { parseArgs, run } from "../src/cli.ts";

async function main() {
  try {
    const command = parseArgs(process.argv.slice(2));
    await run(command);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
