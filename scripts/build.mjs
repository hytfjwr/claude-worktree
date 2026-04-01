import { build } from "esbuild";
import { chmodSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf-8"));

await build({
  entryPoints: ["bin/claude-worktree.ts"],
  outfile: "dist/bin/claude-worktree.js",
  bundle: true,
  minify: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  define: { PACKAGE_VERSION: JSON.stringify(version) },
});

chmodSync("dist/bin/claude-worktree.js", 0o755);
