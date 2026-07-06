---
title: Self-hosting the full stack
description: Run the Manabrew relay and web client together on one host with Docker Compose, behind a single Caddy instance with automatic TLS.
---

The [relay](/hosting-relay/) and [web client](/hosting-web-client/) can be
self-hosted independently, but the common case is running both on one box: the
relay handles matchmaking and message relay, and the web client is what players
open in their browser. This page wires them together behind a single Caddy
instance that terminates TLS for both.

Both build from the **repo root**, so start from a checkout:

```bash
git clone https://github.com/witchesofthehill/manabrew.git
cd manabrew
```

## Compose file

```yaml
services:
  relay:
    build:
      context: .
      dockerfile: manabrew-rs/crates/manabrew-server/Dockerfile
    environment:
      MANABREW_SERVER_KEY: "${MANABREW_SERVER_KEY:?set MANABREW_SERVER_KEY}"
      RUST_LOG: "manabrew_server=info"
    expose:
      - "9443" # reached through Caddy, not published directly
      - "9444"
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
      args:
        VITE_RELAY_HOST: relay.example.com
        VITE_RELAY_PORT: "443"
        VITE_RELAY_PASSWORD: "${MANABREW_SERVER_KEY:?set MANABREW_SERVER_KEY}"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - relay
    restart: unless-stopped

volumes:
  caddy-data:
  caddy-config:
```

The same `MANABREW_SERVER_KEY` is used twice: the relay checks it, and the web
build bakes it in as `VITE_RELAY_PASSWORD` so the client can authenticate.

## Caddyfile

Two vhosts on the one Caddy: the app, and the relay proxied to the `relay`
service. Because the web build sets `VITE_RELAY_PORT: "443"`, the client dials
`wss://relay.example.com`, which Caddy terminates and forwards to the plain-`ws`
relay on `9443`.

```caddyfile
# Point both play.example.com and relay.example.com at this host in DNS.
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

relay.example.com {
	reverse_proxy relay:9443 {
		health_uri /health
		health_port 9444
	}
}
```

## Run it

```bash
MANABREW_SERVER_KEY=pick-a-key docker compose up --build
```

With both hostnames pointed at the box, Caddy issues Let's Encrypt certificates
automatically. Players open `https://play.example.com`; their client connects to
`wss://relay.example.com`.

## Going further

- **Play vs AI on the server.** The web build runs single-player AI client-side
  (in WASM), so this stack needs no game node. To host games with the Java Forge
  engine instead, add a [self-hosted node](/self-hosting/).
- **Production reference.** `compose.production.yml` and `ops/Caddyfile` in the
  repo are the real manabrew.app deployment — they add the landing and docs
  sites, an opt-in hosted-AI node, resource limits, and health checks on top of
  the two services here.
