type Color = { r: number; g: number; b: number };

export type ColorTheme = { base: Color; bright: Color };

export type Spinner = {
  stop: (finalMessage?: string) => void;
  fail: (message: string) => void;
  /**
   * @param lines - The most recent tail lines to display (up to TAIL_LINE_COUNT)
   * @param totalCount - Total number of lines seen since spinner start, used to compute hidden line count
   * @param allLines - All lines accumulated since spinner start, used for expanded view
   */
  updateTail: (lines: string[], totalCount: number, allLines?: string[]) => void;
  /** Returns true when the spinner is in expanded (Ctrl+O) mode */
  isExpanded: () => boolean;
};
