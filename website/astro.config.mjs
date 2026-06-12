// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// No `base`: the wasm app owns the domain root. The landing page lives at
// /home (src/pages/home.astro) and the docs under /docs because the content
// files are nested in src/content/docs/docs/ — keep that folder nesting.
export default defineConfig({
  site: "https://manabrew.app",
  vite: {
    server: {
      fs: { allow: [".."] },
    },
  },
  integrations: [
    starlight({
      title: "ManaBrew",
      description:
        "An open-source Magic: The Gathering client and rules engine, built around Forge compatibility.",
      favicon: "/favicon-32x32.png",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/witchesofthehill/manabrew",
        },
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.gg/NqrKpbhtcd",
        },
      ],
      sidebar: [
        { label: "Start here", items: ["docs", "docs/getting-started"] },
        { label: "Playing", items: ["docs/playing", "docs/formats", "docs/faq"] },
        { label: "Hosting", items: ["docs/self-hosting"] },
        {
          label: "Project",
          items: ["docs/contributing", "docs/releases", "docs/privacy"],
        },
      ],
      editLink: {
        baseUrl: "https://github.com/witchesofthehill/manabrew/edit/main/website/",
      },
      components: {
        Head: "./src/components/Head.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      customCss: [
        "@fontsource/cormorant-garamond/600.css",
        "@fontsource/cormorant-garamond/700.css",
        "@fontsource/alegreya-sans/400.css",
        "@fontsource/alegreya-sans/500.css",
        "@fontsource/alegreya-sans/700.css",
        "./src/styles/starlight.css",
      ],
    }),
  ],
});
