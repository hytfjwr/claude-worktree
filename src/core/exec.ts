import { spawn } from "node:child_process";

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

/**
 * Error thrown when a command exits with non-zero code (unless .nothrow() is used).
 */
export class ExecError extends Error {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;

  constructor(message: string, exitCode: number, stdout: Buffer, stderr: Buffer) {
    super(message);
    this.name = "ExecError";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  text(): string {
    return this.stdout.toString("utf-8");
  }
}

/**
 * Builder for constructing and executing a shell command.
 * Supports chaining `.nothrow()`, `.quiet()`, and `.cwd()` before awaiting.
 *
 * Can be awaited directly (returns ExecResult) or call `.text()` for stdout string.
 */
export class ExecBuilder implements PromiseLike<ExecResult> {
  private _nothrow = false;
  private _quiet = false;
  private _cwd: string | undefined;

  constructor(
    private readonly cmd: string,
    private readonly args: string[],
  ) {}

  /** Do not throw on non-zero exit code. */
  nothrow(): ExecBuilder {
    this._nothrow = true;
    return this;
  }

  /** Suppress stdout/stderr from appearing in the terminal. */
  quiet(): ExecBuilder {
    this._quiet = true;
    return this;
  }

  /** Set the working directory for the command. */
  cwd(dir: string): ExecBuilder {
    this._cwd = dir;
    return this;
  }

  /**
   * Execute the command and return stdout as a UTF-8 string.
   * Terminal output is suppressed (equivalent to .quiet().text()).
   */
  async text(): Promise<string> {
    const result = await this.execute(true);
    return result.text();
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional PromiseLike implementation for builder pattern
  then<TResult1 = ExecResult, TResult2 = never>(
    onfulfilled?: ((value: ExecResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute(this._quiet).then(onfulfilled, onrejected);
  }

  private execute(suppressOutput: boolean): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      const proc = spawn(this.cmd, this.args, {
        cwd: this._cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        if (!suppressOutput) {
          const canContinue = process.stdout.write(chunk);
          if (!canContinue) {
            proc.stdout.pause();
            process.stdout.once("drain", () => proc.stdout.resume());
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        if (!suppressOutput) {
          const canContinue = process.stderr.write(chunk);
          if (!canContinue) {
            proc.stderr.pause();
            process.stderr.once("drain", () => proc.stderr.resume());
          }
        }
      });

      proc.on("error", reject);

      proc.on("close", (code) => {
        const exitCode = code ?? 1;
        const stdout = Buffer.concat(stdoutChunks);
        const stderr = Buffer.concat(stderrChunks);

        if (exitCode !== 0 && !this._nothrow) {
          reject(
            new ExecError(
              `Command failed with exit code ${exitCode}: ${this.cmd} ${this.args.map((a) => JSON.stringify(a)).join(" ")}`,
              exitCode,
              stdout,
              stderr,
            ),
          );
          return;
        }

        resolve({
          exitCode,
          stdout,
          stderr,
          text() {
            return stdout.toString("utf-8");
          },
        });
      });

      proc.stdin.end();
    });
  }
}

/**
 * Execute a command with the given arguments.
 *
 * Returns an ExecBuilder that can be:
 * - Awaited directly: `const result = await exec("git", ["status"])`
 * - Chained: `await exec("git", ["status"]).nothrow().quiet()`
 * - Used for text: `const text = await exec("git", ["rev-parse", "--show-toplevel"]).text()`
 *
 * @example
 * // Get stdout as text
 * const branch = (await exec("git", ["branch", "--show-current"]).text()).trim();
 *
 * @example
 * // Check exit code without throwing
 * const result = await exec("git", ["status"]).nothrow().quiet();
 * if (result.exitCode !== 0) { ... }
 *
 * @example
 * // Run with working directory
 * const result = await exec("sh", ["-c", command]).cwd("/tmp").nothrow();
 */
export function exec(cmd: string, args: string[]): ExecBuilder {
  return new ExecBuilder(cmd, args);
}
