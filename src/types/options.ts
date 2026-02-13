export type BooleanOptionDef = {
  type: "boolean";
  flag: string;
  alias?: string;
};

export type StringOptionDef = {
  type: "string";
  flag: string;
  alias?: string;
  errorMessage: string;
};

export type OptionDef = BooleanOptionDef | StringOptionDef;

export type OptionSchema = {
  options: Record<string, OptionDef>;
  unknownHandling: "passthrough" | "error";
  ignoredFlags?: string[];
  unknownErrorPrefix?: string;
};

export type ExtractResult = {
  booleans: Record<string, boolean>;
  strings: Record<string, string | undefined>;
  remaining: string[];
};
