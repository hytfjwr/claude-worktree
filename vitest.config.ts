import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
  define: { PACKAGE_VERSION: JSON.stringify(version) },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["vitest.setup.ts"],
    coverage: {
      provider: "v8",
      exclude: [
        "bin/**",
        "dist/**",
        "scripts/**",
        "vitest.config.ts",
        "src/index.ts",
        "src/types.ts",
        "src/__test-utils__.ts",
      ],
      thresholds: {
        statements: 75,
        lines: 75,
        functions: 80,
        branches: 90,
      },
    },
  },
});
