import type { HelpEntry, HelpSection, HelpSpec } from "../types/index.ts";
import { bold, cyan, dim } from "./color.ts";

export type { HelpEntry, HelpSection, HelpSectionKind, HelpSpec } from "../types/index.ts";

const DEFAULT_WIDTH = 80;
const MAX_WIDTH = 100;
const INDENT = "  "; // 2 spaces
const GAP = 2; // spaces between the two columns
const MIN_DESC_WIDTH = 20; // below this the two-column layout is dropped

function terminalWidth(): number {
  return Math.min(process.stdout.columns || DEFAULT_WIDTH, MAX_WIDTH);
}

/** Greedily wraps text into lines no wider than `width`. A single word longer than `width` is kept whole. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [];
  }
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/** Colorizes a left-column token: placeholders (`<...>`) dim, everything else cyan. */
function colorizeLeft(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (token.trim() === "") {
        return token;
      }
      return token.startsWith("<") ? dim(token) : cyan(token);
    })
    .join("");
}

/** Colorizes a usage line: placeholders (`<...>`) and optional groups (`[...]`) dim, everything else plain. */
function colorizeUsage(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (token.trim() === "") {
        return token;
      }
      return token.startsWith("<") || token.startsWith("[") ? dim(token) : token;
    })
    .join("");
}

function entryLabel(entry: HelpEntry): string {
  return entry.flags ?? entry.arg ?? "";
}

/** Renders a two-column (label + description) section: options, commands, or arguments. */
function renderTwoColumnSection(section: HelpSection): string {
  const lines: string[] = [bold(`${section.title}:`)];
  const width = terminalWidth();
  const labelWidth = Math.max(...section.entries.map((entry) => entryLabel(entry).length));
  const descColumn = INDENT.length + labelWidth + GAP;
  const descWidth = width - descColumn;

  for (const entry of section.entries) {
    const left = entryLabel(entry);
    const description = entry.description ?? "";

    if (descWidth >= MIN_DESC_WIDTH) {
      const descLines = description ? wrap(description, descWidth) : [];
      if (descLines.length === 0) {
        lines.push(`${INDENT}${colorizeLeft(left)}`);
        continue;
      }
      const padding = " ".repeat(labelWidth - left.length + GAP);
      lines.push(`${INDENT}${colorizeLeft(left)}${padding}${descLines[0]}`);
      for (let i = 1; i < descLines.length; i++) {
        lines.push(`${" ".repeat(descColumn)}${descLines[i]}`);
      }
    } else {
      lines.push(`${INDENT}${colorizeLeft(left)}`);
      if (description) {
        const stackedWidth = Math.max(width - 4, MIN_DESC_WIDTH);
        for (const descLine of wrap(description, stackedWidth)) {
          lines.push(`    ${descLine}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/** Renders a single-column examples section: each entry as-is, unwrapped, un-colorized. */
function renderExamplesSection(section: HelpSection): string {
  const lines: string[] = [bold(`${section.title}:`)];
  for (const entry of section.entries) {
    lines.push(`${INDENT}${entry.arg ?? entry.flags ?? ""}`);
  }
  return lines.join("\n");
}

export function renderHelp(spec: HelpSpec): string {
  const width = terminalWidth();
  const blocks: string[] = [];

  blocks.push(`${bold(spec.name)} - ${spec.tagline}`);

  if (spec.description) {
    blocks.push(wrap(spec.description, width).join("\n"));
  }

  if (spec.usage.length > 0) {
    const usageLines = [bold("Usage:"), ...spec.usage.map((line) => `${INDENT}${colorizeUsage(line)}`)];
    blocks.push(usageLines.join("\n"));
  }

  for (const section of spec.sections) {
    if (section.entries.length === 0) {
      continue;
    }
    blocks.push(section.kind === "examples" ? renderExamplesSection(section) : renderTwoColumnSection(section));
  }

  return blocks.join("\n\n");
}
