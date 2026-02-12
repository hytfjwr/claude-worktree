import { icons } from "./icons.ts";

export interface Logger {
  log(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

const defaultLogger: Logger = {
  log: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
  debug: (msg) => console.debug(msg),
};

let currentLogger: Logger = defaultLogger;

export function logInfo(msg: string): void {
  currentLogger.log(msg);
}

export function logWarn(msg: string): void {
  currentLogger.warn(`${icons.warning()} ${msg}`);
}

export function logError(msg: string): void {
  currentLogger.error(`${icons.error()} ${msg}`);
}

export function logDebug(msg: string): void {
  currentLogger.debug(msg);
}

export function setLogger(logger: Logger): void {
  currentLogger = logger;
}

export function resetLogger(): void {
  currentLogger = defaultLogger;
}

export function createSilentLogger(): Logger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}
