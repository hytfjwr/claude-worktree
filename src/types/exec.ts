/**
 * Result of a command execution.
 */
export interface ExecResult {
  /** Process exit code (0 = success) */
  readonly exitCode: number;
  /** Captured stdout as a Buffer */
  readonly stdout: Buffer;
  /** Captured stderr as a Buffer */
  readonly stderr: Buffer;
  /** Returns stdout as a UTF-8 string */
  text(): string;
}
