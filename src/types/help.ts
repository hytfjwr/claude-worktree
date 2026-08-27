/** One row of a help section: a left column (flags or a placeholder) and its description. */
export type HelpEntry = {
  /** Option flag spelling, e.g. "-p, -pane" or "-plan <file>". */
  flags?: string;
  /** Positional argument, command name, or example text, e.g. "<branch-name>" or "resume". */
  arg?: string;
  /** Right column text. Omitted for single-column sections such as examples. */
  description?: string;
};

export type HelpSectionKind = "options" | "commands" | "arguments" | "examples";

export type HelpSection = {
  /** Section heading without the trailing colon, e.g. "Options". */
  title: string;
  kind: HelpSectionKind;
  entries: HelpEntry[];
};

export type HelpSpec = {
  /** Command name shown in the header, e.g. "claude-worktree" or "claude-worktree <branch-name>". */
  name: string;
  /** One-line summary shown after the name. */
  tagline: string;
  /** Optional paragraph shown under the header. */
  description?: string;
  /** Usage lines, rendered under a "Usage:" heading. */
  usage: string[];
  sections: HelpSection[];
};
