export type SelectItem<T> = {
  value: T;
  label: string;
  description?: string;
  hint?: string;
};

/** Visible window over a candidate list. `visibleEnd` is exclusive. */
export type Viewport = {
  offset: number;
  visibleStart: number;
  visibleEnd: number;
  hiddenAbove: number;
  hiddenBelow: number;
};

/**
 * One item that survived the filter. `labelMatches` holds the code point
 * indices matched inside the label, and is empty when the query only matched
 * the description or the hint.
 */
export type FilterMatch = {
  index: number;
  labelMatches: number[];
};
