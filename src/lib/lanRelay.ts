/**
 * Falling back to the local network when the configured relay is out of reach.
 *
 * There is no LAN mode to switch into. The app tries the relay it is configured
 * for; if that is unreachable it looks for a room already being hosted nearby,
 * and if there is none it hosts one itself. Whichever it lands on, everything
 * downstream is the ordinary room flow against an ordinary relay, so nothing
 * above this file knows the difference.
 */
import { getPlatform } from "@/platform";

interface LanEndpoint {
  name: string;
  host: string;
  port: number;
  /** `relay` is an always-on server worth connecting to; `room` is one table on
   *  somebody's desktop. Absent on builds from before the distinction. */
  role?: "relay" | "room";
  /** The relay key that host runs with. Not a secret: the identity proof in
   *  `Authenticate` is the real handshake, and a room password is what makes a
   *  room private. */
  key: string;
}

interface LocalRelayInfo {
  host: string;
  port: number;
  password: string;
  lanHost?: string;
}

export interface LanTarget {
  host: string;
  port: number;
  password: string;
  /** True when this machine is the one serving the session. */
  hosting: boolean;
  name?: string;
}

const DISCOVER_TIMEOUT_MS = 2000;

/** Whether a connection failure was "nobody answered", as opposed to the relay
 *  answering and turning us away. Only the first is worth a local fallback. */
export function isUnreachable(error: string | null): boolean {
  return !!error && /failed to connect/i.test(error);
}

async function discover(): Promise<LanEndpoint[]> {
  const platform = getPlatform();
  if (platform.type !== "tauri") return [];
  return platform
    .invoke<LanEndpoint[]>("discover_lan_rooms", { timeoutMs: DISCOVER_TIMEOUT_MS })
    .catch(() => []);
}

function target(found: LanEndpoint): LanTarget {
  return {
    host: found.host,
    port: found.port,
    password: found.key,
    hosting: false,
    name: found.name,
  };
}

/**
 * A relay answering on this network, which is this network's lobby and wins
 * over the configured one.
 *
 * Only `role: "relay"` counts; a `room` is one table on a desktop and belongs
 * to the fallback below. The record is unsigned mDNS, so anything can claim to
 * be a relay: safe only because being wrong means an unexpected lobby, never
 * trusting what that host says.
 */
export async function findLanRelay(): Promise<LanTarget | null> {
  const relay = (await discover()).find((entry) => entry.role === "relay");
  return relay ? target(relay) : null;
}

/** A relay or room on this network, hosting one if nobody else is. Null off the
 *  desktop, where neither discovery nor hosting exists. */
export async function findOrHostLanRelay(): Promise<LanTarget | null> {
  const found = (await discover())[0];
  if (found) return target(found);

  const platform = getPlatform();
  if (platform.type !== "tauri") return null;
  const info = await platform
    .invoke<LocalRelayInfo>("start_local_relay", { shareOnLan: true })
    .catch(() => null);
  if (!info?.lanHost) return null;
  return { host: info.host, port: info.port, password: info.password, hosting: true };
}
