import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";

const host = process.env.TAURI_DEV_HOST;
const hubApiTarget = process.env.VITE_HUB_API_URL || "https://api.manabrew.app";

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

const COEP = "require-corp";

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

function cardGlintAssets(): Plugin {
  const rendererWasm = readFileSync(fileURLToPath(import.meta.resolve("card-glint/renderer.wasm")));
  return {
    name: "card-glint-assets",
    augmentChunkHash: (chunk) =>
      chunk.name === "card-glint"
        ? createHash("sha256").update(rendererWasm).digest("hex")
        : undefined,
    generateBundle(_options, bundle) {
      const packageRoot = fileURLToPath(new URL("../../", import.meta.resolve("card-glint")));
      const rendererChunk = Object.values(bundle).find(
        (output) => output.type === "chunk" && output.name === "card-glint",
      );
      if (rendererChunk) {
        this.emitFile({
          type: "asset",
          fileName: `${path.posix.dirname(rendererChunk.fileName)}/renderer_bg.wasm`,
          source: rendererWasm,
        });
      }
      for (const file of ["LICENSE-MIT", "LICENSE-APACHE", "NOTICE.md", "games/magic/NOTICE.md"]) {
        this.emitFile({
          type: "asset",
          fileName: `card-glint-licenses/${file.replaceAll("/", "-")}`,
          source: readFileSync(path.resolve(packageRoot, file)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["@lingui/babel-plugin-lingui-macro"],
      },
    }),
    lingui(),
    tailwindcss(),
    Icons({
      compiler: "raw",
    }),
    crossOriginIsolation(),
    cardGlintAssets(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The client shares the Forge seat and card-selection modules with the
      // published @manabrew/forge-wasm package rather than keeping a copy.
      "@forge-wasm": path.resolve(__dirname, "./packages/forge-wasm"),
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
      "/hub-api": {
        target: hubApiTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hub-api/, ""),
      },
      "/spellbook-api": {
        target: "https://backend.commanderspellbook.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/spellbook-api/, ""),
      },
      "/cubecobra-download": {
        target: "https://cubecobra.com",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            delete proxyRes.headers["set-cookie"];
          });
        },
        rewrite: (p) => p.replace(/^\/cubecobra-download/, ""),
      },
      "/scryfall-symbols": {
        target: "https://svgs.scryfall.io",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/scryfall-symbols/, "/card-symbols"),
      },
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@/wasm/wasm", "ironsmith-wasm", "card-glint"],
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.replaceAll("\\", "/").includes("/node_modules/card-glint/") ? "card-glint" : undefined,
        chunkFileNames: (chunk) =>
          chunk.name === "card-glint"
            ? "assets/card-glint-[hash]/index.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
