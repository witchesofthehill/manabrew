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

function makeRelay(host: string, port: unknown, password: unknown): KnownRelay {
  const parsed = Number(port);
  return {
    name: host,
    host,
    port: Number.isFinite(parsed) && parsed > 0 ? parsed : 9443,
    password: typeof password === "string" && password ? password : "forge",
  };
}

// The default relay, resolved in priority order:
//   1. runtime config (`window.__MANABREW_RUNTIME__`, written from RELAY_* env
//      by the published web image's entrypoint) — one image, any relay;
//   2. build-time `VITE_RELAY_*` (baked by `Dockerfile.web` or a source build);
//   3. the official public relay.
// Port defaults to 9443 (plain `ws://`); set 443 when the relay sits behind a
// TLS proxy so the client dials `wss://`.
function defaultRelay(): KnownRelay {
  const runtime = typeof window !== "undefined" ? window.__MANABREW_RUNTIME__?.relay : undefined;
  const runtimeHost = runtime?.host?.trim();
  if (runtime && runtimeHost) return makeRelay(runtimeHost, runtime.port, runtime.password);

  const envHost = import.meta.env.VITE_RELAY_HOST?.trim();
  if (envHost)
    return makeRelay(envHost, import.meta.env.VITE_RELAY_PORT, import.meta.env.VITE_RELAY_PASSWORD);

  return OFFICIAL_MANABREW;
}

export const KNOWN_RELAYS: KnownRelay[] = [defaultRelay()];
