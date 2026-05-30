import { fetchSetPool } from "@/api/limitedEdition";
import { getPlatform } from "@/platform";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import type { DraftCard, SealedPool } from "@/types/limited";
import type { RoomInfo } from "@/types/server";

function hashStringToU32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const U53_MASK = (1n << 53n) - 1n;

function seatSeed(baseSeed: number | undefined, username: string, roomId: string): number {
  const base = BigInt(baseSeed ?? 0);
  const userHash = BigInt(hashStringToU32(username));
  const roomHash = BigInt(hashStringToU32(roomId));
  return Number((base ^ userHash ^ roomHash) & U53_MASK);
}

export interface StartMpSealedArgs {
  room: RoomInfo;
  username: string;
}

export async function startMpSealed({ room, username }: StartMpSealedArgs): Promise<SealedPool> {
  const store = useMultiplayerSealedStore.getState();
  const config = room.sealed_config;
  if (!config) {
    const msg = "room has no sealed_config";
    store.setError(msg);
    throw new Error(msg);
  }
  const platform = getPlatform();

  let pool: DraftCard[];
  try {
    pool = await fetchSetPool(config.set_code);
  } catch (err) {
    const msg = `failed to load set ${config.set_code}: ${String(err)}`;
    store.setError(msg);
    throw new Error(msg);
  }

  const seed = seatSeed(config.base_seed, username, room.room_id);
  let sealed: SealedPool;
  try {
    sealed = await platform.invoke<SealedPool>("limited_start_sealed", {
      setup: {
        poolType: "Full",
        numBoosters: config.num_boosters,
        pool,
        seed,
      },
    });
  } catch (err) {
    const msg = `engine refused sealed start: ${String(err)}`;
    store.setError(msg);
    throw new Error(msg);
  }

  store.enter({
    roomId: room.room_id,
    setCode: config.set_code,
    pool: sealed.cards,
    sessionId: sealed.sessionId,
  });
  return sealed;
}
