import { exec } from "../core/exec.ts";
import type { CreatedPane, HerdrAgentStatus, HerdrPane, PaneOptions } from "../types/index.ts";

export const HERDR_SHELL_READY_TIMEOUT_MS = 15_000;
export const HERDR_SHELL_READY_INTERVAL_MS = 500;

const AGENT_STATUSES: readonly HerdrAgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

let herdrAvailableCache: boolean | undefined;

export function isRunningInsideHerdr(): boolean {
  return process.env.HERDR_ENV === "1";
}

export function getCurrentPaneId(): string | undefined {
  return process.env.HERDR_PANE_ID;
}

export async function checkHerdrAvailable(): Promise<boolean> {
  try {
    const result = await exec("which", ["herdr"]).nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function isHerdrServerRunning(): Promise<boolean> {
  try {
    const result = await exec("herdr", ["status", "server"]).nothrow().quiet();
    if (result.exitCode !== 0) return false;
    return /^status:\s*running\s*$/m.test(result.text());
  } catch {
    return false;
  }
}

export async function listHerdrPanes(): Promise<HerdrPane[] | null> {
  try {
    if (herdrAvailableCache === undefined) {
      herdrAvailableCache = await checkHerdrAvailable();
    }
    if (!herdrAvailableCache) return null;

    const result = await exec("herdr", ["pane", "list"]).nothrow().quiet();
    if (result.exitCode !== 0) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text());
    } catch {
      return null;
    }

    const panesRaw = (parsed as { result?: { panes?: unknown } })?.result?.panes;
    if (!Array.isArray(panesRaw)) return null;

    const panes: HerdrPane[] = [];
    for (const raw of panesRaw) {
      const p = raw as Record<string, unknown>;
      if (typeof p.pane_id !== "string" || typeof p.workspace_id !== "string") continue;

      const title =
        typeof p.terminal_title_stripped === "string"
          ? p.terminal_title_stripped
          : typeof p.terminal_title === "string"
            ? p.terminal_title
            : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : typeof p.foreground_cwd === "string" ? p.foreground_cwd : "";
      const agentStatus = AGENT_STATUSES.includes(p.agent_status as HerdrAgentStatus)
        ? (p.agent_status as HerdrAgentStatus)
        : "unknown";

      panes.push({
        paneId: p.pane_id,
        workspaceId: p.workspace_id,
        title,
        cwd,
        agentStatus,
      });
    }
    return panes;
  } catch {
    return null;
  }
}

export async function createWorkspace(options: { cwd?: string; label?: string }): Promise<CreatedPane> {
  const args = ["workspace", "create", "--no-focus"];
  if (options.cwd) {
    args.push("--cwd", options.cwd);
  }
  if (options.label) {
    args.push("--label", options.label);
  }

  const result = await exec("herdr", args).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error(`herdr workspace create failed: ${describeHerdrError(result)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.text()) as Record<string, unknown>;
  } catch {
    throw new Error("herdr workspace create returned an unexpected response");
  }
  const parsedResult = parsed.result as Record<string, unknown> | undefined;
  const workspace = parsedResult?.workspace as Record<string, unknown> | undefined;
  const rootPane = parsedResult?.root_pane as Record<string, unknown> | undefined;
  const workspaceId = workspace?.workspace_id;
  const paneId = rootPane?.pane_id;
  if (typeof workspaceId !== "string" || typeof paneId !== "string") {
    throw new Error("herdr workspace create returned an unexpected response");
  }

  return { paneId, workspaceId };
}

export async function isShellReady(paneId: string): Promise<boolean> {
  const result = await exec("herdr", ["pane", "process-info", "--pane", paneId]).nothrow().quiet();
  if (result.exitCode !== 0) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text());
  } catch {
    return false;
  }

  const parsedResult = (parsed as Record<string, unknown>).result as Record<string, unknown> | undefined;
  const info = parsedResult?.process_info as Record<string, unknown> | undefined;
  if (!info) return false;

  const fg = info.foreground_processes;
  const shellPid = info.shell_pid;
  return (
    Array.isArray(fg) &&
    fg.length === 1 &&
    typeof shellPid === "number" &&
    (fg[0] as Record<string, unknown>)?.pid === shellPid
  );
}

export async function waitForShellReady(
  paneId: string,
  options: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? HERDR_SHELL_READY_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? HERDR_SHELL_READY_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isShellReady(paneId)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `herdr pane ${paneId} did not reach an interactive shell prompt within ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    await sleep(intervalMs);
  }
}

export async function runCommand(paneId: string, command: string): Promise<void> {
  const result = await exec("herdr", ["pane", "run", paneId, command]).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error(`herdr pane run failed: ${describeHerdrError(result)}`);
  }
}

export async function sendCommand(paneId: string, command: string): Promise<void> {
  await waitForShellReady(paneId);
  await runCommand(paneId, command);
}

export async function closeWorkspace(workspaceId: string): Promise<void> {
  await exec("herdr", ["workspace", "close", workspaceId]).quiet();
}

export async function closePane(paneId: string): Promise<void> {
  await exec("herdr", ["pane", "close", paneId]).quiet();
}

export async function createPane(options?: PaneOptions): Promise<CreatedPane> {
  return createWorkspace({ cwd: options?.cwd, label: options?.label });
}

export async function closeCreatedPane(pane: CreatedPane): Promise<void> {
  if (pane.workspaceId) {
    await closeWorkspace(pane.workspaceId);
  } else {
    await closePane(pane.paneId);
  }
}

function describeHerdrError(result: { exitCode: number; stderr: Buffer }): string {
  const trimmed = result.stderr.toString().trim();
  try {
    const parsed = JSON.parse(trimmed) as { error?: { code?: unknown; message?: unknown } };
    const code = parsed.error?.code;
    const message = parsed.error?.message;
    if (typeof code === "string" && typeof message === "string") {
      return `${code}: ${message}`;
    }
    if (typeof message === "string") {
      return message;
    }
  } catch {
    // fall through to raw stderr
  }
  return trimmed || `exit code ${result.exitCode}`;
}
