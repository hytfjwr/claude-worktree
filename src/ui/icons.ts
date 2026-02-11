import { isColorEnabled } from "./color.ts";

function icon(rich: string, plain: string): () => string {
  return () => (isColorEnabled() ? rich : plain);
}

export const icons = {
  success: icon("\u2713", "*"),
  fail: icon("\u2717", "x"),
  warning: icon("\u26a0\ufe0f", "!"),
  done: icon("\u2705", "[done]"),
  error: icon("\u274c", "[error]"),

  pin: icon("\ud83d\udccd", "[pin]"),
  tree: icon("\ud83c\udf33", "[tree]"),
  branch: icon("\ud83c\udf3f", "[branch]"),
  folder: icon("\ud83d\udcc2", "[folder]"),
  clipboard: icon("\ud83d\udccb", "[clipboard]"),
  memo: icon("\ud83d\udcdd", "[memo]"),
  merge: icon("\ud83d\udd00", "[merge]"),
  trash: icon("\ud83d\uddd1\ufe0f", "[trash]"),
  window: icon("\ud83e\ude9f", "[window]"),
  sparkle: icon("\u2728", "[sparkle]"),
  lock: icon("\ud83d\udd12", "[lock]"),

  bullet: icon("\u2022", "*"),
  active: icon("\u25cf", "*"),
  inactive: icon("\u25cb", "o"),
};
