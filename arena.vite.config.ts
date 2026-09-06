import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { forgeWasm } from "@manabrew/forge-wasm/vite";

export default defineConfig({
  publicDir: false,
  plugins: [react(), forgeWasm()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "127.0.0.1",
    port: 1420,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  build: { outDir: "dist-arena", rollupOptions: { input: ["arena.html", "duel.html"] } },
});
