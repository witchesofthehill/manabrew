// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Landing page only — served at the root of manabrew.app. The docs site is a
// separate build (astro.config.docs.mjs, srcDir src/) served at
// docs.manabrew.app; the wasm app lives at play.manabrew.app.

// Blog posts carry their pubDate as sitemap lastmod. Other pages get none:
// the build has no git metadata, so a made-up date would just be ignored.
const blogDir = new URL("./src-landing/content/blog/", import.meta.url);
const blogLastmod = Object.fromEntries(
  readdirSync(blogDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const date = readFileSync(new URL(f, blogDir), "utf8").match(/^pubDate:\s*"?(\S+?)"?\s*$/m);
      return [`/blog/${f.replace(/\.md$/, "")}/`, date?.[1]];
    }),
);

export default defineConfig({
  site: "https://manabrew.app",
  srcDir: "./src-landing",
  outDir: "./dist/landing",
  // Starlight ships its own sitemap for the docs build; the landing build
  // needs one explicitly or the blog is only discoverable by crawling links.
  integrations: [
    sitemap({
      serialize(item) {
        const lastmod = blogLastmod[new URL(item.url).pathname];
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
  vite: {
    server: {
      fs: { allow: [".."] },
    },
  },
});
