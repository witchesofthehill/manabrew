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

export function isHostedEngineAvailable(): boolean {
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
