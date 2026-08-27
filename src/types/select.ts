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
