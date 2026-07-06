export interface KnownRelay {
  name: string;
  host: string;
  port: number;
  password: string;
}

// The relay password is a shared access token, not a secret, so it lives in
// plaintext here and is shown in the UI.
const OFFICIAL_MANABREW: KnownRelay = {
  name: "Official Manabrew",
  host: "relay.manabrew.app",
  port: 443,
  password: "725c5fba479c4e59605e39988e31cb76813afa55cd1e71488c4dd2aae998164b",
};

// Self-hosted web builds bake their relay in via `VITE_RELAY_*` (see
// `Dockerfile.web` build args). When `VITE_RELAY_HOST` is set the built-in
// server points at that relay instead of the official one; unset builds keep
// the official default. Port defaults to 9443 (plain `ws://`); set 443 when the
// relay sits behind a TLS proxy so the client dials `wss://`.
function configuredRelay(): KnownRelay {
  const host = import.meta.env.VITE_RELAY_HOST?.trim();
  if (!host) return OFFICIAL_MANABREW;
  const port = Number(import.meta.env.VITE_RELAY_PORT);
  return {
    name: host,
    host,
    port: Number.isFinite(port) && port > 0 ? port : 9443,
    password: import.meta.env.VITE_RELAY_PASSWORD ?? "forge",
  };
}

export const KNOWN_RELAYS: KnownRelay[] = [configuredRelay()];
