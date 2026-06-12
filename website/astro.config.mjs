// @ts-check
import { defineConfig } from "astro/config";

// Landing page only — served at the root of manabrew.app. The docs site is a
// separate build (astro.config.docs.mjs, srcDir src/) served at
// docs.manabrew.app; the wasm app lives at play.manabrew.app.
export default defineConfig({
  site: "https://manabrew.app",
  srcDir: "./src-landing",
  outDir: "./dist/landing",
  vite: {
    server: {
      fs: { allow: [".."] },
    },
  },
});
