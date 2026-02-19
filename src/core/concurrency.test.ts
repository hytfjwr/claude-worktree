import { describe, expect, it } from "vitest";

import { promiseAllLimit } from "./concurrency.ts";

describe("promiseAllLimit", () => {
  it("returns results in order", async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)];
    const results = await promiseAllLimit(tasks);
    expect(results).toEqual([1, 2, 3]);
  });

  it("handles empty task array", async () => {
    const results = await promiseAllLimit([]);
    expect(results).toEqual([]);
  });

  it("handles single task", async () => {
    const results = await promiseAllLimit([() => Promise.resolve("only")]);
    expect(results).toEqual(["only"]);
  });

  it("respects concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;

    const createTask = (value: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return value;
    };

    const tasks = Array.from({ length: 10 }, (_, i) => createTask(i));
    const results = await promiseAllLimit(tasks, 3);

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });

  it("uses default concurrency of 5", async () => {
    let running = 0;
    let maxRunning = 0;

    const createTask = (value: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return value;
    };

    const tasks = Array.from({ length: 20 }, (_, i) => createTask(i));
    await promiseAllLimit(tasks);

    expect(maxRunning).toBeLessThanOrEqual(5);
  });

  it("propagates errors", async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.reject(new Error("fail")), () => Promise.resolve(3)];
    await expect(promiseAllLimit(tasks)).rejects.toThrow("fail");
  });

  it("works when limit exceeds task count", async () => {
    const tasks = [() => Promise.resolve("a"), () => Promise.resolve("b")];
    const results = await promiseAllLimit(tasks, 100);
    expect(results).toEqual(["a", "b"]);
  });

  it("coerces invalid limit to 1", async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)];
    expect(await promiseAllLimit(tasks, 0)).toEqual([1, 2, 3]);
    expect(await promiseAllLimit(tasks, -5)).toEqual([1, 2, 3]);
    expect(await promiseAllLimit(tasks, Number.NaN)).toEqual([1, 2, 3]);
  });
});
