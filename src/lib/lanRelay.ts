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

interface LanRoom {
  name: string;
  host: string;
  port: number;
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
  if (!error) return false;
  return /failed to connect/i.test(error);
}

/**
 * A relay on this network, hosting one if nobody else is. Returns null off the
 * desktop, where neither discovery nor hosting exists.
 */
export async function findOrHostLanRelay(): Promise<LanTarget | null> {
  const platform = getPlatform();
  if (platform.type !== "tauri") return null;

  const found = await platform
    .invoke<LanRoom[]>("discover_lan_rooms", { timeoutMs: DISCOVER_TIMEOUT_MS })
    .catch(() => [] as LanRoom[]);
  const room = found[0];
  if (room) {
    return {
      host: room.host,
      port: room.port,
      password: room.key,
      hosting: false,
      name: room.name,
    };
  }

  const info = await platform
    .invoke<LocalRelayInfo>("start_local_relay", { shareOnLan: true })
    .catch(() => null);
  if (!info?.lanHost) return null;
  return { host: info.host, port: info.port, password: info.password, hosting: true };
}
