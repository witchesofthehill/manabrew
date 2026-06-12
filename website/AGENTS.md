# website/ — Landing page + docs site

Astro + Starlight static site serving `manabrew.app/home` (landing page) and `manabrew.app/docs` (documentation). The wasm app owns the domain root; this site's `dist/` is merged into the same Caddy web root (`/srv/manabrew`) by `Dockerfile.web`, so its output must never contain a root `index.html`.

## Layout

- `src/pages/home.astro` — the landing page (route `/home`). Self-contained: palette, fonts, and styles live in this file. Keep the `:root` palette in sync with `src/styles/starlight.css`.
- `src/content/docs/docs/` — documentation content. The extra `docs/` nesting is what puts the routes under `/docs` — there is no Astro `base`. Keep the nesting.
- `src/styles/starlight.css` — Starlight theme overrides (amber/tavern palette).
- Landing-page images are imported via relative paths that escape this folder (`../images/`, `../public/manabrew_brewery_1.png`) — `vite.server.fs.allow` in `astro.config.mjs` and the directory layout in the `website` Docker stage both exist to support this.

## Constraints

- **Package manager is npm here** (not yarn): `npm install`, `npm run dev`, `npm run build`. The Docker stage runs `npm ci` against `website/package-lock.json` — commit lockfile changes.
- **Node 20.** Astro is pinned to v5 and Starlight to 0.37.x because Starlight ≥0.38 requires Astro 6, which requires Node ≥22. Don't bump those majors until the repo toolchain (local + `Dockerfile.web`) moves to Node 22.
- **Public content only.** Do not publish internal agent docs (`docs/agents/`, DSL grammar/semantics) here; this site is user-facing.
- Verify landing-page changes at ~390px viewport — fluid layout, no fixed widths.

## Deploy

`Dockerfile.web` builds this site in its own stage and copies `dist/` into `/srv/manabrew`. `ops/Caddyfile` routes `/home*` and `/docs*` to those files ahead of the SPA fallback. `deploy.sh` classifies `website/*` changes as `WEB_CHANGED` (rebuilds the `manabrew` image).
