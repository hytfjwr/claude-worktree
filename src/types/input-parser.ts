/** Keys whose meaning does not depend on what the selector is doing. */
export type ControlKey =
  | "ctrl_c"
  | "enter"
  | "escape"
  | "backspace"
  | "ctrl_u"
  | "ctrl_p"
  | "ctrl_n"
  | "up"
  | "down"
  | "left"
  | "right"
  | "page_up"
  | "page_down"
  | "home"
  | "end";

export type MouseButton = "left" | "middle" | "right" | "wheel_up" | "wheel_down" | "other";

export type MouseInput = {
  kind: "mouse";
  button: MouseButton;
  /** True for a button press, false for a release. */
  pressed: boolean;
  /** True when the event only reports motion (button-event tracking). */
  motion: boolean;
  /** 1-based terminal column and row. */
  x: number;
  y: number;
};

export type InputAction =
  | { kind: "key"; key: ControlKey }
  | { kind: "text"; text: string }
  | MouseInput
  | { kind: "cursor_position"; row: number; col: number };

export type ParseInputResult = {
  actions: InputAction[];
  /** Trailing bytes of an unfinished sequence, to be prepended to the next chunk. */
  rest: Buffer;
};
