import type { WorktreeStatus } from "./git";

export async function confirm(message: string): Promise<boolean> {
  process.stdout.write(`${message} (y/N): `);

  for await (const line of console) {
    const input = line.trim().toLowerCase();
    return input === "y" || input === "yes";
  }

  return false;
}

export async function selectMultiple(
  statuses: WorktreeStatus[]
): Promise<WorktreeStatus[]> {
  console.log("\n削除するworktreeを選択してください（番号をスペース区切りで入力）:");
  console.log("例: 1 3 5 または all で全選択、空でキャンセル\n");

  statuses.forEach((status, index) => {
    const marker = status.canAutoClean ? "●" : "○";
    const branch = status.worktree.branch || "(detached)";
    console.log(`  ${index + 1}. ${marker} ${branch}`);
    console.log(`     Path: ${status.worktree.path}`);
    console.log(`     Status: ${status.reason}`);
  });

  process.stdout.write("\n選択: ");

  for await (const line of console) {
    const input = line.trim().toLowerCase();

    if (!input) {
      return [];
    }

    if (input === "all") {
      return statuses;
    }

    const indices = input
      .split(/\s+/)
      .map((s) => Number.parseInt(s, 10) - 1)
      .filter((i) => i >= 0 && i < statuses.length);

    return indices.map((i) => statuses[i]);
  }

  return [];
}
