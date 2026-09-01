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
    .invoke<LanEndpoint[]>("discover_lan_rooms", { timeoutMs: DISCOVER_TIMEOUT_MS })
    .catch(() => [] as LanEndpoint[]);
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

/**
 * A relay answering on this network, if one is.
 *
 * Only `role: "relay"` counts. That is a machine someone set up to be the lobby
 * for this network; a `room` is one table on a desktop, which the fallback
 * above already handles and which nobody should be moved onto wholesale.
 *
 * The caller decides whether to act on it. Note the record is plain mDNS and
 * therefore unauthenticated: anything on the network can claim to be a relay,
 * so this is only ever safe where being wrong means "a lobby you did not
 * expect", never where it means trusting what that host says. Identity is
 * still proved to the relay, and a private room still needs its password.
 */
export async function findLanRelay(): Promise<LanTarget | null> {
  const platform = getPlatform();
  if (platform.type !== "tauri") return null;

  const found = await platform
    .invoke<LanEndpoint[]>("discover_lan_rooms", { timeoutMs: DISCOVER_TIMEOUT_MS })
    .catch(() => [] as LanEndpoint[]);
  const relay = found.find((entry) => entry.role === "relay");
  if (!relay) return null;
  return {
    host: relay.host,
    port: relay.port,
    password: relay.key,
    hosting: false,
    name: relay.name,
  };
}
