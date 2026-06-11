import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/hosted-bridge/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
  },
});
