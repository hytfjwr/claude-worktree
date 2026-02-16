import type { ExitCodeValue } from "../types/index.ts";
import { ExitCode } from "../types/index.ts";

export { ExitCode, type ExitCodeValue };

/**
 * Error thrown for invalid CLI arguments or options.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Error thrown when a git operation fails.
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

/**
 * Error thrown when a required external tool is not available.
 */
export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyError";
  }
}

/**
 * Error thrown when a hook execution fails or times out.
 */
export class HookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookError";
  }
}

/**
 * Maps an error to the appropriate exit code.
 */
export function toExitCode(error: unknown): ExitCodeValue {
  if (error instanceof UsageError) return ExitCode.usage;
  if (error instanceof GitError) return ExitCode.git;
  if (error instanceof DependencyError) return ExitCode.dependency;
  if (error instanceof HookError) return ExitCode.hook;
  return ExitCode.general;
}

/**
 * Type guard: checks if an unknown error is a Node.js ErrnoException.
 */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  if (!(err instanceof Error)) {
    return false;
  }
  if (!Object.hasOwn(err, "code")) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "undefined";
}

/**
 * Error thrown when a file lock cannot be acquired after all retries.
 */
export class LockAcquisitionError extends Error {
  constructor(lockFile: string) {
    const name = lockFile.split("/").pop() ?? lockFile;
    super(`Failed to acquire lock: ${name}`);
    this.name = "LockAcquisitionError";
  }
}

/**
 * Safely extract an error message from an unknown error.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
