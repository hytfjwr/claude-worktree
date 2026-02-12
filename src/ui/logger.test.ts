import { afterEach, describe, expect, test, vi } from "vitest";

import { icons } from "./icons.ts";
import { createSilentLogger, logDebug, logError, logInfo, logWarn, resetLogger, setLogger } from "./logger.ts";

afterEach(() => {
  resetLogger();
});

describe("default logger", () => {
  test("logInfo delegates to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  test("logWarn delegates to console.warn with warning icon", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("warning");
    expect(spy).toHaveBeenCalledWith(`${icons.warning()} warning`);
    spy.mockRestore();
  });

  test("logError delegates to console.error with error icon", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("err");
    expect(spy).toHaveBeenCalledWith(`${icons.error()} err`);
    spy.mockRestore();
  });

  test("logDebug delegates to console.debug", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logDebug("dbg");
    expect(spy).toHaveBeenCalledWith("dbg");
    spy.mockRestore();
  });
});

describe("setLogger", () => {
  test("replaces the active logger", () => {
    const messages: string[] = [];
    setLogger({
      log: (msg) => messages.push(`log:${msg}`),
      warn: (msg) => messages.push(`warn:${msg}`),
      error: (msg) => messages.push(`error:${msg}`),
      debug: (msg) => messages.push(`debug:${msg}`),
    });

    logInfo("a");
    logWarn("b");
    logError("c");
    logDebug("d");

    expect(messages).toEqual(["log:a", `warn:${icons.warning()} b`, `error:${icons.error()} c`, "debug:d"]);
  });
});

describe("resetLogger", () => {
  test("restores the default logger", () => {
    setLogger(createSilentLogger());
    resetLogger();

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("restored");
    expect(spy).toHaveBeenCalledWith("restored");
    spy.mockRestore();
  });
});

describe("createSilentLogger", () => {
  test("suppresses all output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    setLogger(createSilentLogger());
    logInfo("a");
    logWarn("b");
    logError("c");
    logDebug("d");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });
});
