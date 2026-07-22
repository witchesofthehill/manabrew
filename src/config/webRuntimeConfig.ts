import { KNOWN_RELAYS } from "@/config/knownRelays";

export interface ServerConnectionDefaults {
  host: string;
  port: number;
  username: string;
  password: string;
}

export function getStatusBannerUrl(): string {
  return import.meta.env.VITE_STATUS_BANNER_URL || "https://play.manabrew.app/status.json";
}

export function getHubApiUrl(): string {
  return import.meta.env.VITE_HUB_API_URL || "https://api.manabrew.app";
}

export function isHostedEngineAvailable(): boolean {
  // Runtime config (written from HOSTED_AI_ENABLED by the web image entrypoint)
  // wins over the build-time default, so the generic published image can ship
  // this off and a deployment can turn it on without a rebuild.
  const runtime =
    typeof window !== "undefined" ? window.__MANABREW_RUNTIME__?.hostedAiEnabled : undefined;
  if (typeof runtime === "boolean") return runtime;
  return ["1", "true", "yes", "on"].includes(
    (import.meta.env.VITE_HOSTED_AI_ENABLED ?? "").toLowerCase(),
  );
}

export function getServerConnectionDefaults(): ServerConnectionDefaults {
  const relay = KNOWN_RELAYS[0];
  return {
    host: relay.host,
    port: relay.port,
    username: "",
    password: relay.password,
  };
}

export function getHostedAiServerConnectionDefaults(): ServerConnectionDefaults {
  return getServerConnectionDefaults();
}
