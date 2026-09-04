/** Print one JSON document per line to stdout, independent of the logger's quiet state. */
export function printJsonLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
