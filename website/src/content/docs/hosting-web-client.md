---
title: Hosting the web client
description: Serve the ManaBrew browser client as a static site with the cross-origin isolation headers it needs to run games.
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
`ops/Caddyfile` in the repo is a working reference configuration.
