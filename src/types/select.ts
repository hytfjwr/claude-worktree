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

/** Where each frame line lands, used to map a mouse row to a candidate. */
export type FrameLayout = {
  /** Frame line index -> index into the visible matches. */
  lineToVisible: Map<number, number>;
  scrollUpLine: number | null;
  scrollDownLine: number | null;
};

export type ClickTarget =
  | { kind: "row"; visibleIndex: number }
  | { kind: "scroll_up" }
  | { kind: "scroll_down" }
  | { kind: "none" };
