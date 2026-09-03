import { spawn } from "node:child_process";

import type { SpawnInteractiveOptions } from "../types/index.ts";
import { reportTerminalCwd } from "../ui/osc.ts";

export type { SpawnInteractiveOptions } from "../types/index.ts";

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

  // Report the worktree directory so the terminal emulator (e.g. WezTerm splits)
  // stays anchored to it while the child process runs, then restore the original
  // directory once it exits — see src/ui/osc.ts for why this is necessary.
  const returnCwd = cwd ? process.cwd() : undefined;
  if (cwd) reportTerminalCwd(cwd);

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
      if (returnCwd) reportTerminalCwd(returnCwd);
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
