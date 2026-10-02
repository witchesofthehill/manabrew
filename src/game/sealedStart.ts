import { fetchCubeMetadata, fetchSetPool } from "@/api/limitedEdition";
import { getPlatform } from "@/platform";
import { registerLimitedSession, requestLimitedResync } from "@/game/limitedSession";
import { useServerStore } from "@/stores/useServerStore";
import { resolveSealedPool } from "@/lib/limited.utils";
import type { MpDraftSeatAssignment } from "@/game/draftRelay";
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
const starts = new Map<string, Promise<SealedPool>>();
export interface StartMpSealedArgs {
  room: RoomInfo;
  username: string;
}
export async function startMpSealed({
  room,
  username,
}: StartMpSealedArgs): Promise<SealedPool | null> {
  if (room.host !== username) {
    await requestLimitedResync();
    return null;
  }
  if (!useServerStore.getState().hasRelayFeature("limited_sessions"))
    throw new Error("Update the relay to use multiplayer Limited sessions.");
  const existing = starts.get(room.room_id);
  if (existing) return existing;
  const start = generateHostPools(room);
  starts.set(room.room_id, start);
  try {
    return await start;
  } catch (error) {
    starts.delete(room.room_id);
    throw error;
  }
}
async function generateHostPools(room: RoomInfo): Promise<SealedPool> {
  const config = room.sealed_config;
  if (!config) throw new Error("This room has no Sealed configuration.");
  let source: DraftCard[];
  let singleton = config.singleton;
  if (config.cube_id) {
    const cube = await fetchCubeMetadata(config.cube_id);
    source = cube.pool ?? [];
    singleton = cube.singleton;
  } else if (config.set_code) source = await fetchSetPool(config.set_code);
  else throw new Error("Choose a set or cube before opening Sealed.");
  const orderedPlayers = [...room.players].sort(
    (a, b) => Number(b.username === room.host) - Number(a.username === room.host),
  );
  const seats: MpDraftSeatAssignment[] = orderedPlayers.map((player, seat) => ({
    seat,
    playerSlot: player.username,
    displayName: player.username,
    isHuman: !player.is_bot,
  }));
  for (let seat = seats.length; seat < room.max_players; seat++)
    seats.push({ seat, playerSlot: null, displayName: `AI ${seat}`, isHuman: false });
  const generated: Array<{
    seat: number;
    pool: DraftCard[];
    sealed: SealedPool;
    build: { main: DraftCard[]; sideboard: DraftCard[] } | null;
  }> = [];
  for (const seat of seats) {
    const seed =
      config.base_seed === undefined
        ? undefined
        : Number(
            (BigInt(config.base_seed) ^
              BigInt(hashStringToU32(seat.playerSlot ?? `ai-${seat.seat}`)) ^
              BigInt(hashStringToU32(room.room_id))) &
              ((1n << 53n) - 1n),
          );
    const sealed = await resolveSealedPool(
      await getPlatform().invoke<SealedPool>("limited_start_sealed", {
        setup: {
          poolType: config.cube_id ? "Custom" : "Full",
          numBoosters: config.num_boosters,
          pool: source,
          seed,
          singleton,
        },
      }),
    );
    if (!seat.isHuman && !sealed.suggestedDeck)
      throw new Error(`Could not build ${seat.displayName}'s Sealed deck.`);
    generated.push({
      seat: seat.seat,
      pool: sealed.cards,
      sealed: { ...sealed, aiDecks: [] },
      build: sealed.suggestedDeck
        ? { main: sealed.suggestedDeck.main, sideboard: sealed.suggestedDeck.sideboard }
        : null,
    });
  }
  const own = generated[0].sealed;
  await registerLimitedSession({
    kind: "sealed",
    sessionId: own.sessionId,
    room,
    seats,
    pools: generated,
  });
  return own;
}
export function clearSealedStart() {
  starts.clear();
}
