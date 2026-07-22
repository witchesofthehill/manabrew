import path from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";

const host = process.env.TAURI_DEV_HOST;

// The release flow's authoritative version. `cargo xtask release` bumps this
// manifest plus the mirrors (package.json, src-tauri/tauri.conf.json,
// Cargo.toml) in the same release commit, then tags vX.Y.Z — so the manifest
// always matches the shipped release tag, even if package.json is hand-edited
// out of sync.
const appVersion = (
  JSON.parse(readFileSync(path.resolve(__dirname, "ops/manifest.json"), "utf-8")) as {
    packages: Record<string, string>;
  }
).packages["manabrew"];

const COEP = process.env.TAURI_ENV_PLATFORM ? "require-corp" : "credentialless";

function crossOriginIsolation(): Plugin {
  return {
    name: "cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", COEP);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    Icons({
      compiler: "raw",
    }),
    crossOriginIsolation(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      useFsEvents: false,
      usePolling: true,
      interval: 750,
      ignored: [
        "**/.logs/**",
        "**/forge/**",
        "**/forge-harness/**",
        "**/manabrew-rs/**",
        "**/node_modules/**",
        "**/parity_decks/**",
        "**/src-tauri/**",
        "**/target/**",
        "**/website/**",
      ],
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": COEP,
    },
    proxy: {
      "/spellbook-api": {
        target: "https://backend.commanderspellbook.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/spellbook-api/, ""),
      },
      "/scryfall-symbols": {
        target: "https://svgs.scryfall.io",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/scryfall-symbols/, "/card-symbols"),
      },
      "/scryfall-img": {
        target: "https://cards.scryfall.io",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/scryfall-img/, ""),
      },
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@/wasm/wasm", "ironsmith-wasm"],
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "esnext",
  },
});
