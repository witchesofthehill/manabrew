import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Kept in step with vite.config.ts and tsconfig.app.json.
      "@forge-wasm": path.resolve(__dirname, "./packages/forge-wasm"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
