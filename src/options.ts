import { UsageError } from "./core/errors.ts";
import type { ExtractResult, OptionDef, OptionSchema } from "./types/index.ts";

export function extractOptions(args: string[], schema: OptionSchema): ExtractResult {
  const booleans: Record<string, boolean> = {};
  const strings: Record<string, string | undefined> = {};
  const remaining: string[] = [];

  // Initialize defaults
  for (const [key, def] of Object.entries(schema.options)) {
    if (def.type === "boolean") {
      booleans[key] = false;
    } else {
      strings[key] = undefined;
    }
  }

  // Build lookup maps: flag/alias -> { key, def }
  const flagMap = new Map<string, { key: string; def: OptionDef }>();
  for (const [key, def] of Object.entries(schema.options)) {
    flagMap.set(def.flag, { key, def });
    if (def.alias) {
      flagMap.set(def.alias, { key, def });
    }
  }

  const ignoredSet = new Set(schema.ignoredFlags ?? []);

  // Single-pass scan
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    const entry = flagMap.get(arg);

    if (entry) {
      if (entry.def.type === "boolean") {
        booleans[entry.key] = true;
      } else {
        if (i + 1 >= args.length) {
          throw new UsageError(entry.def.errorMessage);
        }
        strings[entry.key] = args[i + 1];
        i++; // skip the value
      }
    } else if (ignoredSet.has(arg)) {
      // consume and ignore
    } else if (arg.startsWith("--")) {
      const singleDash = `-${arg.slice(2)}`;
      if (flagMap.has(singleDash) || ignoredSet.has(singleDash)) {
        const prefix = schema.unknownErrorPrefix ?? "Unknown option";
        throw new UsageError(`${prefix}: "${arg}" (did you mean "${singleDash}"?)`);
      }
      if (schema.unknownHandling === "error") {
        const prefix = schema.unknownErrorPrefix ?? "Unknown option";
        throw new UsageError(`${prefix}: ${arg}`);
      }
      remaining.push(arg);
    } else if (schema.unknownHandling === "error" && arg.startsWith("-")) {
      const prefix = schema.unknownErrorPrefix ?? "Unknown option";
      throw new UsageError(`${prefix}: ${arg}`);
    } else {
      remaining.push(arg);
    }

    i++;
  }

  return { booleans, strings, remaining };
}
