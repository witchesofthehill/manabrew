import path from "path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";

const host = process.env.TAURI_DEV_HOST;

/** Adds COOP/COEP headers to enable SharedArrayBuffer for Atomics.wait() */
function crossOriginIsolation(): Plugin {
  return {
    name: "cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Resolves `~icons/<set>/<name>` imports (with `?url` / `?raw` /
    // default component export) from the installed `@iconify-json/*`
    // packages. Tree-shaken: only icons actually imported end up in
    // the bundle.
    Icons({
      // `raw` compiler exports the plain SVG string for bare imports —
      // matches our `?raw` usage in `PointerLayer` and avoids pulling
      // in `@svgr/core` which the `jsx` compiler would otherwise need
      // as a peer dependency.
      compiler: "raw",
    }),
    crossOriginIsolation(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri: don't obscure rust errors
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/forge/**", "**/node_modules/**"],
    },
    // Required for SharedArrayBuffer (used by game engine Atomics.wait)
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    // Same-origin Commander Spellbook path; mirrors the /spellbook-api
    // reverse_proxy in ops/Caddyfile so dev and prod share one code path.
    proxy: {
      "/spellbook-api": {
        target: "https://backend.commanderspellbook.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/spellbook-api/, ""),
      },
    },
  },
  // Web Worker configuration
  worker: {
    format: "es",
  },
  // Exclude WASM from dependency optimization
  optimizeDeps: {
    exclude: ["@/wasm/forge_wasm"],
  },
  // Build configuration for WASM
  build: {
    target: "esnext",
  },
});
