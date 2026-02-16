import { defineConfig } from "vitest/config";

export default defineConfig({
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
