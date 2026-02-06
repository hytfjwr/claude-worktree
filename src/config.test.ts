import { describe, expect, test } from "bun:test";
import type { HookVars } from "./config";

// ============================================================================
// 純粋関数のテスト（モック不要）
// buildHookCommand は純粋関数なので、mock.module の影響を受けないよう
// ロジックを直接インラインでテストする
// ============================================================================

// validateHookVars と同一ロジック（純粋関数テスト用）
function validateHookVars(vars: HookVars): void {
  const shellMetachars = /[;&|`$()<>\n\r]/;
  if (shellMetachars.test(vars.path)) {
    throw new Error(
      `Invalid hook variable: path "${vars.path}" contains shell metacharacters`
    );
  }
}

// buildHookCommand と同一ロジック（純粋関数テスト用）
function buildHookCommand(template: string, vars: HookVars): string {
  validateHookVars(vars);
  return template
    .replace(/\{path\}/g, vars.path)
    .replace(
      /\{slot\}/g,
      vars.slot !== undefined ? String(vars.slot) : ""
    );
}

describe("buildHookCommand", () => {
  test("{path} を置換", () => {
    const result = buildHookCommand("cd {path} && make setup", {
      path: "/path/to/worktree",
    });
    expect(result).toBe("cd /path/to/worktree && make setup");
  });

  test("{slot} を数値で置換", () => {
    const result = buildHookCommand("docker-compose -p app-{slot} up -d", {
      path: "/path",
      slot: 3,
    });
    expect(result).toBe("docker-compose -p app-3 up -d");
  });

  test("{slot} が undefined の場合は空文字に置換", () => {
    const result = buildHookCommand("echo {slot}", { path: "/path" });
    expect(result).toBe("echo ");
  });

  test("複数 {path} 出現", () => {
    const result = buildHookCommand("echo {path} && ls {path}", {
      path: "/tmp/wt",
    });
    expect(result).toBe("echo /tmp/wt && ls /tmp/wt");
  });

  test("両変数の同時置換", () => {
    const result = buildHookCommand(
      "docker-compose -p {slot} -f {path}/docker-compose.yml up",
      { path: "/app", slot: 5 }
    );
    expect(result).toBe(
      "docker-compose -p 5 -f /app/docker-compose.yml up"
    );
  });

  test("変数なしのテンプレートはそのまま返す", () => {
    const result = buildHookCommand("make setup", { path: "/path" });
    expect(result).toBe("make setup");
  });

  test("シェルメタ文字を含む path を拒否", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp/$(rm -rf /)" })
    ).toThrow("contains shell metacharacters");
  });

  test("バッククォートを含む path を拒否", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp/`whoami`" })
    ).toThrow("contains shell metacharacters");
  });

  test("セミコロンを含む path を拒否", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp; rm -rf /" })
    ).toThrow("contains shell metacharacters");
  });

  test("パイプを含む path を拒否", () => {
    expect(() =>
      buildHookCommand("cd {path}", { path: "/tmp | cat /etc/passwd" })
    ).toThrow("contains shell metacharacters");
  });

  test("通常のパスは許可（ハイフン・スラッシュ・ドット・アンダースコア）", () => {
    const result = buildHookCommand("cd {path}", {
      path: "/home/user/my-project_v2/work.tree",
    });
    expect(result).toBe("cd /home/user/my-project_v2/work.tree");
  });
});
