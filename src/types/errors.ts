/**
 * Exit codes for different failure categories.
 *
 * | Code | Meaning                                      |
 * |------|----------------------------------------------|
 * | 0    | Success                                      |
 * | 1    | General/unknown error                        |
 * | 2    | Usage error (invalid arguments/options)       |
 * | 3    | Git operation failed                         |
 * | 4    | External tool not available (WezTerm, Claude) |
 * | 5    | Hook execution failed or timed out           |
 * | 6    | Slot exhaustion (no available slots/ports)    |
 * | 130  | Interrupted (Ctrl+C)                         |
 */
export const ExitCode = {
  success: 0,
  general: 1,
  usage: 2,
  git: 3,
  dependency: 4,
  hook: 5,
  slot: 6,
  interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
