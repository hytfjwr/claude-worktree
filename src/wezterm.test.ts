import { describe, expect, test, afterEach, mock } from "bun:test";
import {
  getCurrentPaneId,
  splitPaneRight,
  setTabTitle,
  sendText,
  sendCommand,
  activatePane,
  createPane,
  type WeztermDependencies,
} from "./wezterm";

// テスト用のモック依存関係を作成
function createMockDeps(overrides: Partial<WeztermDependencies> = {}): WeztermDependencies {
  return {
    execShell: mock(() => Promise.resolve("mock-pane-id")),
    spawn: mock(() => ({ exited: Promise.resolve(0) })) as unknown as typeof Bun.spawn,
    getCurrentPaneId: mock(() => "original-pane-id"),
    ...overrides,
  };
}

describe("getCurrentPaneId", () => {
  const originalEnv = process.env.WEZTERM_PANE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WEZTERM_PANE;
    } else {
      process.env.WEZTERM_PANE = originalEnv;
    }
  });

  test("環境変数から取得", () => {
    process.env.WEZTERM_PANE = "123";
    const result = getCurrentPaneId();
    expect(result).toBe("123");
  });

  test("未設定時はundefined", () => {
    delete process.env.WEZTERM_PANE;
    const result = getCurrentPaneId();
    expect(result).toBeUndefined();
  });

  test("DIで注入した関数から取得", () => {
    const deps = createMockDeps({
      getCurrentPaneId: () => "injected-pane-id",
    });
    const result = getCurrentPaneId(deps);
    expect(result).toBe("injected-pane-id");
  });
});

describe("splitPaneRight", () => {
  test("正しいweztermコマンドを実行", async () => {
    let executedCmd = "";
    const deps = createMockDeps({
      execShell: mock(async (cmd: string) => {
        executedCmd = cmd;
        return "new-pane-id";
      }),
    });

    await splitPaneRight(deps);

    expect(executedCmd).toBe("wezterm cli split-pane --right");
  });

  test("返り値のtrimを確認", async () => {
    const deps = createMockDeps({
      execShell: mock(async () => "pane-123"),
    });

    const result = await splitPaneRight(deps);

    expect(result).toBe("pane-123");
  });
});

describe("setTabTitle", () => {
  test("正しい引数でspawnを呼び出す", async () => {
    let spawnArgs: string[] = [];
    const deps = createMockDeps({
      spawn: mock((args: string[]) => {
        spawnArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await setTabTitle("pane-123", "My Title", deps);

    expect(spawnArgs).toEqual([
      "wezterm",
      "cli",
      "set-tab-title",
      "--pane-id",
      "pane-123",
      "My Title",
    ]);
  });
});

describe("sendText", () => {
  test("stdinでテキストを渡す", async () => {
    let spawnOptions: { stdin?: Uint8Array } = {};
    const deps = createMockDeps({
      spawn: mock((_args: string[], opts?: { stdin?: Uint8Array }) => {
        spawnOptions = opts || {};
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await sendText("pane-123", "hello world", deps);

    expect(spawnOptions.stdin).toBeDefined();
    const text = new TextDecoder().decode(spawnOptions.stdin);
    expect(text).toBe("hello world");
  });

  test("--no-pasteフラグが含まれる", async () => {
    let spawnArgs: string[] = [];
    const deps = createMockDeps({
      spawn: mock((args: string[], _opts?: unknown) => {
        spawnArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await sendText("pane-123", "test", deps);

    expect(spawnArgs).toContain("--no-paste");
    expect(spawnArgs).toContain("--pane-id");
    expect(spawnArgs).toContain("pane-123");
  });
});

describe("sendCommand", () => {
  test("改行を追加してsendTextを呼ぶ", async () => {
    let sentText = "";
    const deps = createMockDeps({
      spawn: mock((_args: string[], opts?: { stdin?: Uint8Array }) => {
        if (opts?.stdin) {
          sentText = new TextDecoder().decode(opts.stdin);
        }
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await sendCommand("pane-123", "ls -la", deps);

    expect(sentText).toBe("ls -la\n");
  });
});

describe("activatePane", () => {
  test("正しいpaneIdで呼び出す", async () => {
    let spawnArgs: string[] = [];
    const deps = createMockDeps({
      spawn: mock((args: string[]) => {
        spawnArgs = args;
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await activatePane("target-pane-456", deps);

    expect(spawnArgs).toEqual([
      "wezterm",
      "cli",
      "activate-pane",
      "--pane-id",
      "target-pane-456",
    ]);
  });
});

describe("createPane", () => {
  test("splitPaneRightを呼ぶ", async () => {
    let splitCalled = false;
    const deps = createMockDeps({
      execShell: mock(async (cmd: string) => {
        if (cmd.includes("split-pane")) {
          splitCalled = true;
        }
        return "new-pane";
      }),
    });

    await createPane({}, deps);

    expect(splitCalled).toBe(true);
  });

  test("title指定時にsetTabTitleを呼ぶ", async () => {
    let setTabTitleArgs: string[] = [];
    const deps = createMockDeps({
      execShell: mock(async () => "new-pane"),
      spawn: mock((args: string[]) => {
        if (args.includes("set-tab-title")) {
          setTabTitleArgs = args;
        }
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await createPane({ title: "Test Title" }, deps);

    expect(setTabTitleArgs).toContain("set-tab-title");
    expect(setTabTitleArgs).toContain("Test Title");
  });

  test("title未指定時はsetTabTitleを呼ばない", async () => {
    let setTabTitleCalled = false;
    const deps = createMockDeps({
      execShell: mock(async () => "new-pane"),
      spawn: mock((args: string[]) => {
        if (args.includes("set-tab-title")) {
          setTabTitleCalled = true;
        }
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await createPane({}, deps);

    expect(setTabTitleCalled).toBe(false);
  });

  test("keepFocus時にactivatePaneを呼ぶ", async () => {
    let activatePaneArgs: string[] = [];
    const deps = createMockDeps({
      execShell: mock(async () => "new-pane"),
      getCurrentPaneId: () => "original-pane-100",
      spawn: mock((args: string[]) => {
        if (args.includes("activate-pane")) {
          activatePaneArgs = args;
        }
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await createPane({ keepFocus: true }, deps);

    expect(activatePaneArgs).toContain("activate-pane");
    expect(activatePaneArgs).toContain("original-pane-100");
  });

  test("keepFocus + WEZTERM_PANE未設定時はactivatePaneを呼ばない", async () => {
    let activatePaneCalled = false;
    const deps = createMockDeps({
      execShell: mock(async () => "new-pane"),
      getCurrentPaneId: () => undefined,
      spawn: mock((args: string[]) => {
        if (args.includes("activate-pane")) {
          activatePaneCalled = true;
        }
        return { exited: Promise.resolve(0) };
      }) as unknown as typeof Bun.spawn,
    });

    await createPane({ keepFocus: true }, deps);

    expect(activatePaneCalled).toBe(false);
  });

  test("createPaneが新しいpaneIdを返す", async () => {
    const deps = createMockDeps({
      execShell: mock(async () => "created-pane-999"),
    });

    const result = await createPane({}, deps);

    expect(result).toBe("created-pane-999");
  });
});
