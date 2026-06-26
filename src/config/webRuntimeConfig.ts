import { KNOWN_RELAYS } from "@/config/knownRelays";

export interface ServerConnectionDefaults {
  host: string;
  port: number;
  username: string;
  password: string;
}

function envFlag(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function envRelayPort(): number | null {
  const raw = import.meta.env.VITE_RELAY_PORT;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isHostedEngineAvailable(): boolean {
  return envFlag(import.meta.env.VITE_HOSTED_AI_ENABLED);
}

export function isManagedRelayConfigured(): boolean {
  return envFlag(import.meta.env.VITE_MANAGED_RELAY);
}

export function getServerConnectionDefaults(): ServerConnectionDefaults {
  const relay = KNOWN_RELAYS[0];
  return {
    host: import.meta.env.VITE_RELAY_HOST || relay.host,
    port: envRelayPort() ?? relay.port,
    username: "",
    password: import.meta.env.VITE_RELAY_PASSWORD || relay.password,
  };
}

export function getHostedAiServerConnectionDefaults(): ServerConnectionDefaults {
  return getServerConnectionDefaults();
}
