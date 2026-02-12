import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read the package version by walking up from the current file's directory
 * until we find package.json. Works from both src/ (dev) and dist/src/ (built).
 */
export function getVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      if (typeof pkg.version === "string") return pkg.version;
    } catch {
      // not found at this level, walk up
    }
    dir = dirname(dir);
  }
  return "unknown";
}
