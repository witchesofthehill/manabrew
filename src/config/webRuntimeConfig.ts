export interface WebRuntimeConfig {
  serverHost?: string;
  serverPort?: number | string;
  serverUsername?: string;
  serverPassword?: string;
  hostedAiEnabled?: boolean | string;
}

export interface ServerConnectionDefaults {
  host: string;
  port: number;
  username: string;
  password: string;
}

declare global {
  interface Window {
    MANABREW_CONFIG?: WebRuntimeConfig;
  }
}

export function getWebRuntimeConfig(): WebRuntimeConfig {
  if (typeof window === "undefined") return {};
  return window.MANABREW_CONFIG ?? {};
}

export function isHostedAiPlayEnabled(): boolean {
  const value = getWebRuntimeConfig().hostedAiEnabled;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }
  return false;
}

export function getServerConnectionDefaults(): ServerConnectionDefaults {
  const config = getWebRuntimeConfig();
  // Runtime config (window.MANABREW_CONFIG, injected by the Docker entrypoint)
  // takes precedence, then the build-time VITE_RELAY_* bake, then a localhost
  // fallback for `yarn dev`.
  return {
    host: stringOrDefault(
      config.serverHost,
      stringOrDefault(import.meta.env.VITE_RELAY_HOST, defaultServerHost()),
    ),
    port: numberOrDefault(
      config.serverPort,
      numberOrDefault(import.meta.env.VITE_RELAY_PORT, 9443),
    ),
    username: stringOrDefault(config.serverUsername, ""),
    password: stringOrDefault(
      config.serverPassword,
      stringOrDefault(import.meta.env.VITE_RELAY_PASSWORD, "forge"),
    ),
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
