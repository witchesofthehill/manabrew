export interface ServerConnectionDefaults {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** Whether this deployment offers the hosted (server-side Java) engine — i.e.
 *  a self-hosted-node is available. Gates the Settings engine toggle; actual
 *  routing also requires the per-user `preferHostedEngine` preference. Baked at
 *  build time via VITE_HOSTED_AI_ENABLED. */
export function isHostedEngineAvailable(): boolean {
  return ["1", "true", "yes", "on"].includes(
    (import.meta.env.VITE_HOSTED_AI_ENABLED ?? "").toLowerCase(),
  );
}

export function getServerConnectionDefaults(): ServerConnectionDefaults {
  // Relay endpoint is baked at build time (VITE_RELAY_*); falls back to the
  // current host / localhost for `yarn dev`.
  return {
    host: stringOrDefault(import.meta.env.VITE_RELAY_HOST, defaultServerHost()),
    port: numberOrDefault(import.meta.env.VITE_RELAY_PORT, 9443),
    username: "",
    password: stringOrDefault(import.meta.env.VITE_RELAY_PASSWORD, "forge"),
  };
}

export function getHostedAiServerConnectionDefaults(): ServerConnectionDefaults {
  return getServerConnectionDefaults();
}

function defaultServerHost(): string {
  if (typeof window === "undefined") return "localhost";
  return window.location.hostname || "localhost";
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOrDefault(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
