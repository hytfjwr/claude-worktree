const DEFAULT_CONCURRENCY = 5;

/**
 * Run async task factories with a concurrency limit.
 * Each element in `tasks` is a zero-arg function that returns a Promise.
 */
export async function promiseAllLimit<T>(tasks: Array<() => Promise<T>>, limit = DEFAULT_CONCURRENCY): Promise<T[]> {
  const effectiveLimit = Math.max(1, Math.floor(limit) || 1);
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(effectiveLimit, tasks.length) }, () => worker()));
  return results;
}
