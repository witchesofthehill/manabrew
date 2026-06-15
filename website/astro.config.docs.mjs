// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Docs site — served at the root of docs.manabrew.app. The landing page is a
// separate build (astro.config.mjs, srcDir src-landing/).
export default defineConfig({
  site: "https://docs.manabrew.app",
  outDir: "./dist/docs",
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
        {
          label: "Start here",
          items: [
            { label: "What is ManaBrew?", link: "/" },
            "getting-started",
            "download-windows",
            "download-macos",
          ],
        },
        { label: "Playing", items: ["playing", "formats", "faq"] },
        {
          label: "Hosting",
          items: ["self-hosting", "hosting-relay", "hosting-web-client"],
        },
        { label: "Project", items: ["contributing", "releases", "privacy"] },
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
