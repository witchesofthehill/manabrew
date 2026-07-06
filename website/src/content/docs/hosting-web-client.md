---
title: Hosting the web client
description: Serve the Manabrew browser client as a static site with Docker Compose, pointed at your own relay, with the cross-origin isolation headers it needs to run games.
---

The browser client is a static site (`yarn build:web` → `dist/`), but it is not
"just static files": the game worker uses `SharedArrayBuffer`, which requires
cross-origin isolation. Whatever serves it — and every proxy in front — must
deliver these headers on the HTML, worker JS, and WASM responses:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

If a proxy strips them, the page loads but games won't start. Verify in
DevTools: `window.crossOriginIsolated` must be `true`. Also note the web client
is not offline-capable — card images come from Scryfall at runtime.

## Pointing at your relay

The default relay endpoint is **baked in at build time**. Set these build args
to make the bundle default to your own relay (see [Hosting your own
relay](/hosting-relay/)):

| Build arg             | Default              | Purpose                                   |
| --------------------- | -------------------- | ----------------------------------------- |
| `VITE_RELAY_HOST`     | `relay.manabrew.app` | Relay host the client connects to         |
| `VITE_RELAY_PORT`     | `9443`               | Relay port — use `443` behind a TLS proxy |
| `VITE_RELAY_PASSWORD` | `forge`              | Shared relay key (`MANABREW_SERVER_KEY`)  |

The client dials `wss://` when the port is `443` and `ws://` otherwise, so a
relay behind a TLS proxy needs `VITE_RELAY_PORT: "443"`. Leaving `VITE_RELAY_HOST`
unset keeps the official public relay. Players can also add extra servers at
runtime from **Settings → Server**.

## With Docker Compose

`Dockerfile.web` builds the bundle and serves it with Caddy, which is also where
the cross-origin isolation headers come from. It builds from the **repo root**:

```bash
git clone https://github.com/witchesofthehill/manabrew.git
cd manabrew
```

Create a `compose.yml`:

```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
      args:
        VITE_RELAY_HOST: relay.example.com
        VITE_RELAY_PORT: "443"
        VITE_RELAY_PASSWORD: "${MANABREW_SERVER_KEY:-forge}"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    restart: unless-stopped

volumes:
  caddy-data:
  caddy-config:
```

Caddy needs a config with the isolation headers. Create a `Caddyfile` next to it
— a single-host trim of the repo's `ops/Caddyfile`:

```caddyfile
# Replace play.example.com with your domain. For a local test use `:80`
# instead, and Caddy will serve plain HTTP with no certificate.
play.example.com {
	root * /srv/manabrew
	encode zstd gzip
	header {
		Cross-Origin-Opener-Policy "same-origin"
		Cross-Origin-Embedder-Policy "credentialless"
		Cross-Origin-Resource-Policy "same-origin"
	}
	try_files {path} /index.html
	file_server
}
```

Then build and serve:

```bash
docker compose up --build
```

With a real domain (and its DNS pointed at the box) Caddy issues a Let's Encrypt
certificate automatically. To serve the client and a relay together behind one
Caddy, see the [full-stack example](/hosting-full-stack/); `ops/Caddyfile` is the
full production reference.
