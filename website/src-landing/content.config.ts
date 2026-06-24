import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Blog lives on the apex marketing site (manabrew.app/blog). Posts are markdown
// under src-landing/content/blog and render through src-landing/pages/blog/.
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src-landing/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().default("The Manabrew team"),
    audience: z.enum(["players", "developers"]),
    hero: z.string().optional(),
    heroAlt: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
