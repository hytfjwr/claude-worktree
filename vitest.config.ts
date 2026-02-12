import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      exclude: ["bin/**", "scripts/**", "src/index.ts", "src/types.ts"],
      thresholds: {
        lines: 65,
        functions: 70,
        branches: 65,
      },
    },
  },
});
