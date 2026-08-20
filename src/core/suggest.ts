/**
 * "Did you mean ...?" suggestions for mistyped CLI arguments.
 *
 * Candidates are ranked by Levenshtein distance, with two adjustments that keep
 * suggestions useful without being noisy:
 * - a clean prefix ("-dry" → "-dry-run") counts as an exact match
 * - short inputs need tighter matches, since a single edit can reach many flags
 */

/** Candidates whose length differs from the input by more than this are never suggested. */
const MAX_LENGTH_DIFF = 3;

/** Minimum input length for a prefix match to count as a suggestion. */
const MIN_PREFIX_LENGTH = 3;

/**
 * Computes the Levenshtein (edit) distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Rolling two-row DP: `previous` holds distances for row i-1, `current` for row i
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

/** Normalizes for comparison so that "--Pane" and "-pane" match on equal footing. */
function normalize(value: string): string {
  return value.replace(/^-+/, "").toLowerCase();
}

/** Maximum edit distance accepted for an input of the given length. */
function maxAllowedDistance(length: number): number {
  if (length <= 2) return 0;
  if (length === 3) return 1;
  return 2;
}

function score(input: string, candidate: string): number {
  if (input.length >= MIN_PREFIX_LENGTH && candidate.startsWith(input)) {
    return 0;
  }
  if (Math.abs(input.length - candidate.length) > MAX_LENGTH_DIFF) {
    return Number.POSITIVE_INFINITY;
  }
  return levenshteinDistance(input, candidate);
}

/**
 * Finds the candidate closest to `input`, or null when nothing is close enough.
 * Leading dashes and letter case are ignored during comparison; the returned
 * value is the candidate exactly as it was given.
 * Ties are resolved in favor of the first candidate in iteration order.
 */
export function findClosestMatch(input: string, candidates: Iterable<string>): string | null {
  const target = normalize(input);
  if (target.length === 0) return null;

  const allowed = maxAllowedDistance(target.length);
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (normalized.length === 0) continue;

    const distance = score(target, normalized);
    if (distance > allowed || distance >= bestDistance) continue;

    bestDistance = distance;
    best = candidate;
  }

  return best;
}
