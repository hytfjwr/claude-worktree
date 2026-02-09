import { $ } from "bun";

export async function isPortInUse(port: number): Promise<boolean> {
  const result = await $`lsof -iTCP:${port} -sTCP:LISTEN`.nothrow().quiet();
  return result.exitCode === 0;
}

export async function findAvailableSlot(basePort: number = 8880, maxSlots: number = 9): Promise<number> {
  for (let i = 1; i <= maxSlots; i++) {
    const port = basePort + i;
    if (!(await isPortInUse(port))) {
      return i;
    }
  }
  throw new Error(`No available slots (all ports ${basePort + 1}-${basePort + maxSlots} are in use)`);
}
