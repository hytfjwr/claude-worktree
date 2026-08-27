/**
 * Terminal display width calculation.
 *
 * `String#length` counts UTF-16 code units, not the number of terminal
 * columns a string occupies. Emoji and CJK text break that assumption:
 * U+2705 ("✅") has length 1 but renders in two columns, and U+1F5D1 U+FE0F
 * ("🗑️") has length 3 but renders in two columns. This module measures width
 * per Unicode code point instead, so UI layout (padding, truncation, line
 * wrapping) lines up with what the terminal actually draws.
 *
 * The width tables below are an approximation of three Unicode references,
 * not a complete implementation of any of them:
 * - Unicode East Asian Width (UAX #11) — the `W` (Wide) and `F` (Fullwidth) blocks
 * - Unicode Emoji (UTS #51) — `Emoji_Presentation=Yes` code points
 * - Unicode general categories `Mn` / `Me` / `Cf` — zero-width code points
 *
 * Known gaps, intentionally not covered:
 * - Tab characters are counted as zero-width control characters rather than
 *   expanded to the next tab stop.
 * - Keycap sequences (e.g. "1" + U+FE0F + U+20E3) count as width 1, though
 *   terminals often draw them as 2.
 * - Regional indicator pairs (flags) are counted one code point at a time at
 *   width 1 each, totaling 2 — the right total by coincidence, not by rule.
 * - East Asian Ambiguous code points are always treated as width 1 (e.g. a
 *   bare U+25FB, U+25FC, or U+26A0 with no variation selector).
 * - Full grapheme cluster segmentation (UAX #29) is not implemented.
 */

/** Inclusive [start, end] code point range. Tables must stay sorted and non-overlapping. */
type CodePointRange = readonly [number, number];

function inRanges(cp: number, ranges: readonly CodePointRange[]): boolean {
  // binary search
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

// Zero-width code points: combining marks (Mn/Me), format characters (Cf) and
// variation selectors. Checked before the wide table because a few combining
// marks (U+3099/U+309A) live inside East Asian Wide blocks.
const ZERO_WIDTH_RANGES: readonly CodePointRange[] = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x0483, 0x0489], // Cyrillic combining marks
  [0x0591, 0x05bd], // Hebrew points
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a], // Arabic marks
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x1ab0, 0x1aff], // Combining Diacritical Marks Extended
  [0x1dc0, 0x1dff], // Combining Diacritical Marks Supplement
  [0x200b, 0x200f], // Zero width space .. right-to-left mark
  [0x2060, 0x2064], // Word joiner .. invisible plus
  [0x20d0, 0x20f0], // Combining Diacritical Marks for Symbols
  [0x3099, 0x309a], // Combining Katakana-Hiragana sound marks
  [0xfe00, 0xfe0f], // Variation Selectors 1-16
  [0xfe20, 0xfe2f], // Combining Half Marks
  [0xfeff, 0xfeff], // Zero width no-break space (BOM)
  [0xe0100, 0xe01ef], // Variation Selectors Supplement
];

// East Asian Wide (W) and Fullwidth (F) blocks, plus the emoji planes that
// terminals render double-width.
const WIDE_RANGES: readonly CodePointRange[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK Radicals .. CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables / Yi Radicals
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical Forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms .. Small Form Variants
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1b000, 0x1b16f], // Kana Supplement .. Small Kana Extension
  [0x1f004, 0x1f004], // Mahjong tile red dragon
  [0x1f0cf, 0x1f0cf], // Playing card black joker
  [0x1f18e, 0x1f18e], // Negative squared AB
  [0x1f191, 0x1f19a], // Squared CL .. Squared VS
  [0x1f200, 0x1f2ff], // Enclosed Ideographic Supplement
  [0x1f300, 0x1faff], // Misc Symbols and Pictographs .. Symbols and Pictographs Extended-A
  [0x20000, 0x2fffd], // CJK Unified Ideographs Extension B..F
  [0x30000, 0x3fffd], // CJK Unified Ideographs Extension G..
];

// Emoji_Presentation=Yes code points in the BMP. These render as emoji (two
// columns) with no variation selector, even though their East Asian Width is
// Neutral or Ambiguous.
const EMOJI_PRESENTATION_RANGES: readonly CodePointRange[] = [
  [0x231a, 0x231b], // Watch, hourglass
  [0x23e9, 0x23ec], // Fast-forward / rewind buttons
  [0x23f0, 0x23f0], // Alarm clock
  [0x23f3, 0x23f3], // Hourglass with flowing sand
  [0x25fd, 0x25fe], // Small squares
  [0x2614, 0x2615], // Umbrella with rain, hot beverage
  [0x2648, 0x2653], // Zodiac signs
  [0x267f, 0x267f], // Wheelchair symbol
  [0x2693, 0x2693], // Anchor
  [0x26a1, 0x26a1], // High voltage
  [0x26aa, 0x26ab], // Medium circles
  [0x26bd, 0x26be], // Soccer ball, baseball
  [0x26c4, 0x26c5], // Snowman, sun behind cloud
  [0x26ce, 0x26ce], // Ophiuchus
  [0x26d4, 0x26d4], // No entry
  [0x26ea, 0x26ea], // Church
  [0x26f2, 0x26f3], // Fountain, flag in hole
  [0x26f5, 0x26f5], // Sailboat
  [0x26fa, 0x26fa], // Tent
  [0x26fd, 0x26fd], // Fuel pump
  [0x2705, 0x2705], // White heavy check mark
  [0x270a, 0x270b], // Raised fist, raised hand
  [0x2728, 0x2728], // Sparkles
  [0x274c, 0x274c], // Cross mark
  [0x274e, 0x274e], // Negative squared cross mark
  [0x2753, 0x2755], // Question / exclamation ornaments
  [0x2757, 0x2757], // Heavy exclamation mark
  [0x2795, 0x2797], // Heavy plus / minus / division sign
  [0x27b0, 0x27b0], // Curly loop
  [0x27bf, 0x27bf], // Double curly loop
  [0x2b1b, 0x2b1c], // Large squares
  [0x2b50, 0x2b50], // White medium star
  [0x2b55, 0x2b55], // Heavy large circle
];

// A text-default symbol followed by U+FE0F (VS16) switches to emoji
// presentation and takes two columns (e.g. U+26A0 U+FE0F "warning"). Approximated
// by the symbol/dingbat area instead of the full Extended_Pictographic property.
const VS16_PROMOTABLE_RANGES: readonly CodePointRange[] = [
  [0x00a9, 0x00a9], // Copyright sign
  [0x00ae, 0x00ae], // Registered sign
  [0x203c, 0x3299], // Double exclamation .. enclosed ideographs
];

export function stripAnsi(str: string): string {
  // CSI sequences (including ? for cursor hide/show), OSC sequences, and simple escapes
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence matching
  return str.replace(/\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07]*(?:\x07|\x1b\\)|\[[0-9;]*m)/g, "");
}

const ZWJ = 0x200d;
const VS16 = 0xfe0f;

/**
 * Display width of a single code point. `next` is the following code point, used
 * to detect emoji presentation via a trailing variation selector.
 */
function codePointWidth(cp: number, next: number | undefined): number {
  // C0/C1 control characters occupy no columns
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0;
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0;
  if (inRanges(cp, EMOJI_PRESENTATION_RANGES)) return 2;
  if (inRanges(cp, WIDE_RANGES)) return 2;
  if (next === VS16 && inRanges(cp, VS16_PROMOTABLE_RANGES)) return 2;
  return 1;
}

type WidthSegment = { text: string; width: number };

/**
 * Splits a string into segments that must not be broken apart: a base code point
 * plus any trailing zero-width code points and ZWJ-joined continuations. An
 * emoji ZWJ sequence therefore counts as a single two-column segment.
 */
function* iterateSegments(plain: string): Generator<WidthSegment> {
  const cps = [...plain];
  let i = 0;
  while (i < cps.length) {
    const start = i;
    const cp = cps[i].codePointAt(0) as number;
    const next = i + 1 < cps.length ? (cps[i + 1].codePointAt(0) as number) : undefined;
    const width = codePointWidth(cp, next);
    i++;
    while (i < cps.length) {
      const cur = cps[i].codePointAt(0) as number;
      if (cur === ZWJ) {
        i++; // the joiner
        if (i < cps.length) i++; // the code point it joins
        continue;
      }
      if (codePointWidth(cur, undefined) === 0) {
        i++;
        continue;
      }
      break;
    }
    yield { text: cps.slice(start, i).join(""), width };
  }
}

/**
 * Display width of a string in terminal columns. ANSI escape sequences are
 * stripped first, then each code point is measured against the width tables.
 */
export function stringWidth(s: string): number {
  let total = 0;
  for (const segment of iterateSegments(stripAnsi(s))) {
    total += segment.width;
  }
  return total;
}

/**
 * Truncates to `maxWidth` display columns, appending `ellipsis`. Never splits a
 * double-width character or a combining/ZWJ cluster, so the result may fall one
 * column short of the budget. ANSI escapes are stripped from the result.
 */
export function truncateToWidth(s: string, maxWidth: number, ellipsis = "…"): string {
  const plain = stripAnsi(s);
  if (stringWidth(plain) <= maxWidth) {
    return plain;
  }
  const budget = maxWidth - stringWidth(ellipsis);
  if (budget <= 0) {
    return ellipsis;
  }
  let out = "";
  let width = 0;
  for (const segment of iterateSegments(plain)) {
    if (width + segment.width > budget) break;
    out += segment.text;
    width += segment.width;
  }
  return `${out}${ellipsis}`;
}

/** Pads with trailing spaces so the string occupies `targetWidth` columns. */
export function padToWidth(s: string, targetWidth: number): string {
  const pad = targetWidth - stringWidth(s);
  return pad > 0 ? `${s}${" ".repeat(pad)}` : s;
}
