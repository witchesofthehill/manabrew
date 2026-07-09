// Runtime configuration for self-hosted deployments. The published web Docker
// image's entrypoint overwrites this file from RELAY_HOST / RELAY_PORT /
// RELAY_PASSWORD at container start, so one image can point at any relay
// without a rebuild. Left empty here (and in source/desktop builds) so the app
// falls back to the relay compiled in via VITE_RELAY_* — or the official default.
window.__MANABREW_RUNTIME__ = {};
