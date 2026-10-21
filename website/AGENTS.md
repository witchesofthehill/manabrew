# website/ - Landing page + docs site

One package, two Astro builds:

| Build   | Config                  | Source         | Output          | Served at            |
| ------- | ----------------------- | -------------- | --------------- | -------------------- |
| Landing | `astro.config.mjs`      | `src-landing/` | `dist/landing/` | `manabrew.app/`      |
| Docs    | `astro.config.docs.mjs` | `src/`         | `dist/docs/`    | `docs.manabrew.app/` |

The wasm app lives at `play.manabrew.app` (its own Caddy vhost, `/srv/manabrew`). `manabrew.app/home` and `manabrew.app/docs/*` are permanent redirects for pre-split URLs.

## Layout

- `src-landing/pages/index.astro` - the landing page. Fonts and styles live in this file; colors come from the shared theme via `define:vars`. Links to the app and docs are absolute (`https://play.manabrew.app`, `https://docs.manabrew.app/`).
- `src/theme.ts` - re-exports the app's canonical Manabrew theme from `../../src/themes/default.ts` and `BRAND_COLORS` from `../../src/themes/brand.ts` (pure data, safe to import at build time). Both builds read this bridge. Use semantic theme colors for text and controls; exact brand anchors are only for decorative effects.
- `src/components/Head.astro` - Starlight `Head` override that injects the theme as `--mb-*` custom properties for both `data-theme` states.
- `src/components/SiteTitle.astro` - Starlight `SiteTitle` override linking to `https://manabrew.app/`. The link has the accessible name `Manabrew`; its SVG is decorative.
- `src/content/docs/` - documentation content at the collection root; routes land at the root of `docs.manabrew.app`. Internal links are root-relative (`/getting-started/`), app links absolute to `play.manabrew.app`.
- `src/styles/starlight.css` - maps the injected `--mb-*` variables onto Starlight's `--sl-color-*` tokens, plus the site fonts.
- `src-landing/pages/robots.txt.ts` and `src/pages/robots.txt.ts` - one `robots.txt` per host, each pointing at its own `sitemap-index.xml` (`@astrojs/sitemap` on the landing build, Starlight's bundled one on docs). `public/` is shared by both builds, so it cannot carry a per-host file.
- `public/` - browser icons use the external brand folder's dedicated `favicon/` exports, mirrored in the app's `/public` directory. Copy SVG and ICO unchanged; resize PNG fallbacks from the supplied PNG, which also supplies the 512px Apple touch and app PWA icons. Keep shipped icons in the repository and designer sources outside it. Preserve the supplied rounded tile and transparent corners in both color schemes. Prefer `/favicon.svg`; do not regenerate favicons from header-logo variants.
- Fonts match the app's self-hosted `@fontsource/alegreya-sans` and `@fontsource-variable/source-sans-3` packages. Load Alegreya Sans `700.css` for display headings at weight 700 with normal styling. Source Sans 3 Variable is for body text and controls, with `wght-italic.css` for emphasized prose. Font license notices ship in `public/fonts/` in both builds. Keep them with font package updates.
- Images and theme data are imported via relative paths that escape this folder (`../images/`, `../public/`, `../src/`) - `vite.server.fs.allow` and the directory layout in the `website` Docker stage both exist to support this. New escapes need a matching `COPY` in `Dockerfile.web`.
- `src/components/BrandLogo.astro` - shared static SVG renderer for all website headers. It imports the app's generated sprite, `src/assets/brandLogoGeometry.json`, and `ManaBrewLogo.css`. Existing links own accessible names; pass `decorative` to their logos. Render complete variant/mode groups without hydration, pointer listeners, reaction controls, or logo animation.
- Landing and blog use `mode="dark"`; docs use `mode="auto"` with `mb-logo-light` / `mb-logo-dark` layers resolved by `html[data-theme]` in shared CSS. Preserve the approved horizontal proportions, theme inks, and transparent cutouts. Regenerate artwork with `python3 scripts/generate-brand-logo.py /path/to/manabrew-brand`.

## Constraints

- **Package manager is yarn here** (`yarn.lock`, no `package-lock.json`): `yarn install`, `yarn dev` (landing), `yarn dev:docs` (docs), `yarn build` (both). The Docker stage runs `yarn install --frozen-lockfile` - commit lockfile changes.
- **Node 20.19.5 or newer.** Local website commands use Node 20; the shared Docker website stage uses Node 24. Astro remains pinned to v5 and Starlight to 0.37.x. Node 20.19.1 fails the locked sitemap package's engine requirement.
- **Public content only.** Do not publish internal agent docs (`docs/agents/`, DSL grammar/semantics) here; this site is user-facing.
- Ember is for actions, purple for selected navigation, and sage for sparse non-interactive details. Primary hover uses `primary-hover` with `primary-foreground`; menus and ordinary hover surfaces stay neutral. Read `../docs/BRAND_DIRECTION.md` for the identity rules.
- Navigation headers reuse the hero cards' `card` surface. Dark mode uses white Brewy with ember/mana accents; light mode uses the approved darker inks with the same balanced horizontal geometry. Keep logo backgrounds transparent and artwork static.
- Verify landing-page changes at ~390px viewport - fluid layout, no fixed widths.
- Full-page overflow checks are separate from brand-header sizing: the landing page's `.last-call` illustration can add horizontal overflow at desktop widths, and the porting-forge-to-rust post's unbroken GitHub URL overflows at 320px.
- Astro layout styles are scoped. Resets that must reach slotted page or Markdown content, such as blog `box-sizing`, need `:global(...)`; a scoped `*` leaves padded child pages wider than mobile viewports.
- Playwright WebKit 26.5 on macOS 27 aborts in `Style::Color::resolvedColor()` when gradient stops mix colors that are themselves `color-mix()` results. Landing-page bubble alpha colors are prepared from the shared hex palette in `define:vars`; keep those inputs flat rather than nesting color mixes.
- Landing and docs share Astro's content cache. Verify both with sequential builds and separate static output roots; concurrent development servers using the two configurations can show empty collections.

## Deploy

`Dockerfile.web` builds both sites in the `website` stage and copies `dist/landing/` → `/srv/landing` and `dist/docs/` → `/srv/docs` (the app bundle stays at `/srv/manabrew`, which `ops/staging.Caddyfile` also assumes). `ops/web.Caddyfile` defines the three vhosts (plain `http://`, mounted into the web container); the `ingress` service terminates TLS and proxies to it (`ops/Caddyfile`). The web image is rebuilt by CI for every release, so `website/*` changes ship with the next tag. `website/` counts as an app path for `cargo xtask release`, so a `fix`/`feat`-typed merge touching it cuts an app release on its own; a `docs`-typed merge waits for the next one; the web recreate picks up `ops/web.Caddyfile` changes, and `cargo xtask deploy` runs an explicit `caddy reload` on ingress for `ops/Caddyfile` changes. DNS: `play` and `docs` are CNAMEs to the apex; ingress auto-issues their certificates.

The final `Dockerfile.web` stage also bakes a **standalone default** so the published `manabrew-web` image runs with no mounted config: `ops/standalone.Caddyfile` (a `:80` vhost with the isolation headers) as the default `/etc/caddy/Caddyfile`, and `ops/web-entrypoint.sh` as the `ENTRYPOINT`. The entrypoint writes `/srv/manabrew/config.js` from `RELAY_HOST`/`RELAY_PORT`/`RELAY_PASSWORD` (runtime relay config, read by `src/config/knownRelays.ts` via `window.__MANABREW_RUNTIME__`) then `exec`s `caddy run`. The production compose mounts `ops/web.Caddyfile` over the baked default and passes no `RELAY_*`, so prod behaviour is unchanged; only pull-and-run self-hosters use the baked path. `.github/workflows/docker-images.yml` builds + pushes `manabrew-server`, `manabrew-web`, and `manabrew-node` (the self-hosted-node Forge room host) to GHCR (`ghcr.io/witchesofthehill/*`) on `v*` tags, authenticating with the built-in `GITHUB_TOKEN` (no registry secrets).
