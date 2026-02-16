import { spawn } from "node:child_process";

export type SpawnInteractiveOptions = {
  /** Shell command string to execute via `sh -c` */
  command: string;
  /** Working directory for the child process */
  cwd?: string;
};

/**
 * Spawn an interactive child process with `stdio: "inherit"` and signal forwarding.
 *
 * - Forwards SIGINT/SIGTERM to the child process once, then removes the handler
 *   so that a second signal terminates the parent immediately.
 * - Cleans up all event listeners when the child closes or errors.
 * - Returns a promise that resolves with the child process exit code (including
 *   non-zero codes) when the child exits, and rejects only on spawn error.
 */
export function spawnInteractive(options: SpawnInteractiveOptions): Promise<number> {
  const { command, cwd } = options;

  return new Promise<number>((resolve, reject) => {
    const proc = spawn("sh", ["-c", command], {
      stdio: ["inherit", "inherit", "inherit"],
      cwd,
    });

    const forwardSignal = (signal: NodeJS.Signals) => {
      try {
        proc.kill(signal);
      } catch {
        // Process may already be dead
      }
    };

    const onSigint = () => {
      process.removeListener("SIGINT", onSigint);
      forwardSignal("SIGINT");
    };
    const onSigterm = () => {
      process.removeListener("SIGTERM", onSigterm);
      forwardSignal("SIGTERM");
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    const cleanup = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };

    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });

    proc.on("close", (code) => {
      cleanup();
      resolve(code ?? 1);
    });
  });
}
