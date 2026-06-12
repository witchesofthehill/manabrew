# website/ — Landing page + docs site

One npm package, two Astro builds:

| Build   | Config                  | Source         | Output          | Served at            |
| ------- | ----------------------- | -------------- | --------------- | -------------------- |
| Landing | `astro.config.mjs`      | `src-landing/` | `dist/landing/` | `manabrew.app/`      |
| Docs    | `astro.config.docs.mjs` | `src/`         | `dist/docs/`    | `docs.manabrew.app/` |

The wasm app lives at `play.manabrew.app` (its own Caddy vhost, `/srv/manabrew`). `manabrew.app/home` and `manabrew.app/docs/*` are permanent redirects for pre-split URLs.

## Layout

- `src-landing/pages/index.astro` — the landing page. Fonts and styles live in this file; colors come from the shared theme via `define:vars`. Links to the app and docs are absolute (`https://play.manabrew.app`, `https://docs.manabrew.app/`).
- `src/theme.ts` — single source of truth for colors: re-exports the app's default preset from `../../src/themes/default.ts` (pure data, safe to import at build time). Both builds read it.
- `src/components/Head.astro` — Starlight `Head` override that injects the preset as `--mb-*` custom properties for both `data-theme` states.
- `src/components/SiteTitle.astro` — Starlight `SiteTitle` override: app logo linking to `https://manabrew.app/`.
- `src/content/docs/` — documentation content at the collection root; routes land at the root of `docs.manabrew.app`. Internal links are root-relative (`/getting-started/`), app links absolute to `play.manabrew.app`.
- `src/styles/starlight.css` — maps the injected `--mb-*` variables onto Starlight's `--sl-color-*` tokens, plus the site fonts.
- `public/` — favicons copied from the app's `/public`, shared by both builds; in production they're byte-identical duplicates of the app's.
- Images and theme data are imported via relative paths that escape this folder (`../images/`, `../public/`, `../src/`) — `vite.server.fs.allow` and the directory layout in the `website` Docker stage both exist to support this. New escapes need a matching `COPY` in `Dockerfile.web`.

## Constraints

- **Package manager is npm here** (not yarn): `npm install`, `npm run dev` (landing), `npm run dev:docs` (docs), `npm run build` (both). The Docker stage runs `npm ci` against `website/package-lock.json` — commit lockfile changes.
- **Node 20.** Astro is pinned to v5 and Starlight to 0.37.x because Starlight ≥0.38 requires Astro 6, which requires Node ≥22. Don't bump those majors until the repo toolchain (local + `Dockerfile.web`) moves to Node 22.
- **Public content only.** Do not publish internal agent docs (`docs/agents/`, DSL grammar/semantics) here; this site is user-facing.
- Verify landing-page changes at ~390px viewport — fluid layout, no fixed widths.

## Deploy

`Dockerfile.web` builds both sites in the `website` stage and copies `dist/landing/` → `/srv/landing` and `dist/docs/` → `/srv/docs` (the app bundle stays at `/srv/manabrew`, which `ops/staging.Caddyfile` also assumes). `ops/Caddyfile` defines the three vhosts. `deploy.sh` classifies `website/*` changes as `WEB_CHANGED` (rebuilds the `manabrew` image); `ops/Caddyfile` changes trigger an explicit `caddy reload`. DNS: `play` and `docs` are CNAMEs to the apex; Caddy auto-issues their certificates.
