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
