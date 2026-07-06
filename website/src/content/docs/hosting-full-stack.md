---
title: Self-hosting the full stack
description: Run the Manabrew relay and web client together on one host with Docker Compose, pulling published images, behind a single Caddy instance with automatic TLS.
---

The [relay](/hosting-relay/) and [web client](/hosting-web-client/) can be
self-hosted independently, but the common case is running both on one box: the
relay handles matchmaking and message relay, and the web client is what players
open in their browser. This page wires them together behind a single Caddy
instance that terminates TLS for both — pulling published images, so no repo
checkout is needed.

## Compose file

```yaml
services:
  relay:
    image: ghcr.io/witchesofthehill/manabrew-server:latest
    environment:
      MANABREW_SERVER_KEY: "${MANABREW_SERVER_KEY:?set MANABREW_SERVER_KEY}"
      RUST_LOG: "manabrew_server=info"
    expose:
      - "9443" # reached through Caddy, not published directly
      - "9444"
    restart: unless-stopped

  web:
    image: ghcr.io/witchesofthehill/manabrew-web:latest
    environment:
      RELAY_HOST: relay.example.com
      RELAY_PORT: "443"
      RELAY_PASSWORD: "${MANABREW_SERVER_KEY:?set MANABREW_SERVER_KEY}"
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
client presents it as `RELAY_PASSWORD` to authenticate.

## Caddyfile

The web image ships a default `:80` config, but for HTTPS across two hostnames
mount your own. Two vhosts on the one Caddy: the app, and the relay proxied to
the `relay` service. Because the web client uses `RELAY_PORT: "443"`, it dials
`wss://relay.example.com`, which Caddy terminates and forwards to the plain-`ws`
relay on `9443`.

```caddyfile
# Point both play.example.com and relay.example.com at this host in DNS.
play.example.com {
	root * /srv/manabrew
	encode zstd gzip

	@config path /config.js
	handle @config {
		header Cache-Control "no-store"
		file_server
	}

	handle {
		header {
			Cross-Origin-Opener-Policy "same-origin"
			Cross-Origin-Embedder-Policy "credentialless"
			Cross-Origin-Resource-Policy "same-origin"
		}
		try_files {path} /index.html
		file_server
	}
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
MANABREW_SERVER_KEY=pick-a-key docker compose up -d
```

With both hostnames pointed at the box, Caddy issues Let's Encrypt certificates
automatically. Players open `https://play.example.com`; their client connects to
`wss://relay.example.com`.

## Going further

- **Build locally instead of pulling.** Swap either `image:` for a `build:`
  block (`context: .` + the crate's Dockerfile) from a repo checkout.
- **Play vs AI on the server.** The web build runs single-player AI client-side
  (in WASM), so this stack needs no game node. To host games with the Java Forge
  engine instead, add a [self-hosted node](/self-hosting/).
- **Production reference.** `compose.production.yml` and `ops/Caddyfile` in the
  repo are the real manabrew.app deployment — they add the landing and docs
  sites, an opt-in hosted-AI node, resource limits, and health checks on top of
  the two services here.
