# website/ — Landing page + docs site

Astro + Starlight static site serving `manabrew.app/home` (landing page) and `manabrew.app/docs` (documentation). The wasm app owns the domain root; this site's `dist/` is merged into the same Caddy web root (`/srv/manabrew`) by `Dockerfile.web`, so its output must never contain a root `index.html`.

## Layout

- `src/pages/home.astro` — the landing page (route `/home`). Fonts and styles live in this file; colors come from the shared theme via `define:vars`.
- `src/theme.ts` — single source of truth for colors: re-exports the app's default preset from `../../src/themes/default.ts` (pure data, safe to import at build time). Both the landing page and the docs theme read from it.
- `src/components/Head.astro` — Starlight `Head` override that injects the preset as `--mb-*` custom properties for both `data-theme` states.
- `src/components/SiteTitle.astro` — Starlight `SiteTitle` override: app logo (`../../src/assets/manaBrew.png`) linking to `/home/`, never `/` (the root belongs to the wasm app and 404s on the dev server).
- `src/content/docs/docs/` — documentation content. The extra `docs/` nesting is what puts the routes under `/docs` — there is no Astro `base`. Keep the nesting.
- `src/styles/starlight.css` — maps the injected `--mb-*` variables onto Starlight's `--sl-color-*` tokens, plus the site fonts.
- `public/` — favicons copied from the app's `/public` so the Astro dev server can serve them; in production they're byte-identical duplicates of the app's, so the web-root merge is harmless.
- Images and theme data are imported via relative paths that escape this folder (`../images/`, `../public/`, `../src/`) — `vite.server.fs.allow` in `astro.config.mjs` and the directory layout in the `website` Docker stage both exist to support this. New escapes need a matching `COPY` in `Dockerfile.web`.

## Constraints

- **Package manager is npm here** (not yarn): `npm install`, `npm run dev`, `npm run build`. The Docker stage runs `npm ci` against `website/package-lock.json` — commit lockfile changes.
- **Node 20.** Astro is pinned to v5 and Starlight to 0.37.x because Starlight ≥0.38 requires Astro 6, which requires Node ≥22. Don't bump those majors until the repo toolchain (local + `Dockerfile.web`) moves to Node 22.
- **Public content only.** Do not publish internal agent docs (`docs/agents/`, DSL grammar/semantics) here; this site is user-facing.
- Verify landing-page changes at ~390px viewport — fluid layout, no fixed widths.

## Deploy

`Dockerfile.web` builds this site in its own stage and copies `dist/` into `/srv/manabrew`. `ops/Caddyfile` routes `/home*` and `/docs*` to those files ahead of the SPA fallback. `deploy.sh` classifies `website/*` changes as `WEB_CHANGED` (rebuilds the `manabrew` image).
