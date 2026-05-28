// Shared "start an MP sealed phase" helper. Both the host (after
// `serverStartGame("Sealed")` returns) and each peer (when their
// `currentRoom.format` flips to `Sealed`) run this same routine —
// no host-coordinated relay, just deterministic per-seat seeding off
// the room's `sealed_config`.

import { fetchSetPool } from "@/api/limitedEdition";
import { getPlatform } from "@/platform";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import type { DraftCard, SealedPool } from "@/types/limited";
import type { RoomInfo } from "@/types/server";

function hashStringToU32(s: string): number {
  // FNV-1a, 32-bit. Stable, no deps, identical on every peer for the
  // same username — required so each player gets the same "their"
  // seed every time they re-enter the room (e.g. reconnect).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seatSeed(baseSeed: number | undefined, username: string, roomId: string): number {
  // Mix base + room + username so:
  // - Different peers in the same room get different pools (username diff)
  // - The same peer reconnecting gets the same pool (deterministic)
  // - A peer rejoining a different room sealed of the same set gets
  //   a different pool (room id diff)
  const base = baseSeed ?? 0;
  return (base ^ hashStringToU32(username) ^ hashStringToU32(roomId)) >>> 0;
}

export interface StartMpSealedArgs {
  room: RoomInfo;
  username: string;
}

/**
 * Generate the local player's sealed pool and flip the store into
 * `building` mode. Returns the resulting `SealedPool` so callers can
 * navigate / react. Throws on any failure — the store keeps `mode:
 * idle` until a successful enter.
 */
export async function startMpSealed({ room, username }: StartMpSealedArgs): Promise<SealedPool> {
  const config = room.sealed_config;
  if (!config) throw new Error("room has no sealed_config");
  const platform = getPlatform();

  let pool: DraftCard[];
  try {
    pool = await fetchSetPool(config.set_code);
  } catch (err) {
    throw new Error(`failed to load set ${config.set_code}: ${String(err)}`);
  }

  const seed = seatSeed(config.base_seed, username, room.room_id);
  const sealed = await platform.invoke<SealedPool>("limited_start_sealed", {
    setup: {
      poolType: "Full",
      numBoosters: config.num_boosters,
      pool,
      seed,
    },
  });

  useMultiplayerSealedStore.getState().enter({
    roomId: room.room_id,
    setCode: config.set_code,
    pool: sealed.cards,
    sessionId: sealed.sessionId,
  });
  return sealed;
}
