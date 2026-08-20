import { UsageError } from "./core/errors.ts";
import { findClosestMatch } from "./core/suggest.ts";
import type { ExtractResult, OptionDef, OptionSchema } from "./types/index.ts";

function unknownOptionError(schema: OptionSchema, arg: string, suggestion: string | null): UsageError {
  const prefix = schema.unknownErrorPrefix ?? "Unknown option";
  return suggestion
    ? new UsageError(`${prefix}: "${arg}" (did you mean "${suggestion}"?)`)
    : new UsageError(`${prefix}: ${arg}`);
}

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

  // Candidates for "did you mean ...?" hints: every flag, alias and ignored flag
  const knownFlags = [...flagMap.keys(), ...ignoredSet];

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
        throw unknownOptionError(schema, arg, singleDash);
      }
      if (schema.unknownHandling === "error") {
        throw unknownOptionError(schema, arg, findClosestMatch(arg, knownFlags));
      }
      remaining.push(arg);
    } else if (schema.unknownHandling === "error" && arg.startsWith("-")) {
      throw unknownOptionError(schema, arg, findClosestMatch(arg, knownFlags));
    } else {
      remaining.push(arg);
    }

    i++;
  }

  return { booleans, strings, remaining };
}
