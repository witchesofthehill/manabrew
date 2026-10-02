import {
  type DraftPickMessage,
  type DraftStartMessage,
  type DraftStateBroadcastMessage,
  isDraftRelay,
  makeDraftRelay,
} from "@/game/draftRelay";
import { getPlatform } from "@/platform";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useServerStore } from "@/stores/useServerStore";
import { attachLimitedSessionPeer } from "@/game/limitedSession";
import type { DraftCard } from "@/types/limited";
import type { RoomRelayEnvelope } from "@/types/server";

let active: { unsubscribe: () => void; myPlayerSlot: string } | null = null;

export function attachDraftPeer(myPlayerSlot: string): () => void {
  if (active && active.myPlayerSlot === myPlayerSlot) {
    return active.unsubscribe;
  }
  if (active) {
    active.unsubscribe();
  }
  const platform = getPlatform();
  attachLimitedSessionPeer();
  const off = platform.events.on<{
    from_player: string;
    state: RoomRelayEnvelope;
  }>("server:room_message", (payload) => {
    onRelay(payload, myPlayerSlot);
  });
  const unsubscribe = () => {
    off();
    if (active && active.myPlayerSlot === myPlayerSlot) active = null;
  };
  active = { unsubscribe, myPlayerSlot };
  return unsubscribe;
}

export function detachDraftPeer(): void {
  if (!active) return;
  active.unsubscribe();
  active = null;
}

function onRelay(
  payload: { from_player: string; state: RoomRelayEnvelope },
  myPlayerSlot: string,
): void {
  if (!isDraftRelay(payload.state)) return;
  const env = payload.state;
  const room = useServerStore.getState().currentRoom;
  if (
    !room ||
    env.roomId !== room.room_id ||
    env.fromPlayer !== payload.from_player ||
    payload.from_player !== room.host ||
    room.host === myPlayerSlot
  )
    return;
  if (env.targetPlayer && env.targetPlayer !== myPlayerSlot) return;
  const msg = env.payload;

  switch (msg.type) {
    case "start":
      handleStart(msg, env, myPlayerSlot);
      return;
    case "stateUpdate":
      if (env.targetPlayer !== myPlayerSlot) return;
      handleStateUpdate(msg);
      return;
    case "pick":
    case "resync":
      return;
  }
}

function handleStart(msg: DraftStartMessage, env: RoomRelayEnvelope, myPlayerSlot: string): void {
  const mySeat = msg.seats.find((s) => s.playerSlot === myPlayerSlot);
  if (!mySeat) {
    return;
  }
  const store = useMultiplayerDraftStore.getState();
  if (store.mode !== "idle") return;
  store.enterAsPeer({
    sessionId: msg.sessionId,
    roomId: env.roomId ?? "",
    config: msg.config,
    seats: msg.seats,
    mySeat: mySeat.seat,
    state: {
      sessionId: msg.sessionId,
      round: 1,
      totalRounds: msg.config.rounds,
      pickNumber: 1,
      packSize: 0,
      currentPack: [],
      pickedPile: [],
      seatSummaries: msg.seats.map((s) => ({
        seat: s.seat,
        name: s.displayName,
        isHuman: s.isHuman,
        picksMade: 0,
        lastPickName: null,
      })),
      isRoundOver: false,
      isComplete: false,
      awaitingHuman: false,
      picksPerPass: msg.config.picksPerPass,
      picksRemainingInPack: 0,
    },
  });
}

function handleStateUpdate(msg: DraftStateBroadcastMessage): void {
  const store = useMultiplayerDraftStore.getState();
  if (store.sessionId !== msg.sessionId || msg.state.sessionId !== msg.sessionId) return;
  if (store.mySeat !== msg.seat) return;
  store.setLocalState(msg.state);
}

export async function submitPeerPick(card: DraftCard): Promise<void> {
  const store = useMultiplayerDraftStore.getState();
  if (!store.sessionId || store.mySeat == null || store.amHost) return;
  if (store.pickPending || !store.state?.awaitingHuman) return;
  const platform = getPlatform();
  const server = platform.server;
  if (!server) return;
  const myPlayerSlot = store.seats.find((s) => s.seat === store.mySeat)?.playerSlot;
  if (!myPlayerSlot) return;
  const hostSlot = store.seats.find((s) => s.seat === 0)?.playerSlot;
  if (!hostSlot) return;

  const msg: DraftPickMessage = {
    type: "pick",
    sessionId: store.sessionId,
    cardId: card.id,
    round: store.state!.round,
    pickNumber: store.state!.pickNumber,
  };
  store.setPickPending(true);
  try {
    await server.sendRoomMessage(
      makeDraftRelay(msg, {
        fromPlayer: myPlayerSlot,
        targetPlayer: hostSlot,
        roomId: store.roomId ?? undefined,
      }),
    );
  } catch (err) {
    store.setPickPending(false);
    throw err;
  }
}

export async function requestDraftResync(): Promise<void> {
  const server = useServerStore.getState();
  const draft = useMultiplayerDraftStore.getState();
  const room = server.currentRoom;
  if (!room?.draft_config || !server.username || room.host === server.username) return;
  await getPlatform().server?.sendRoomMessage(
    makeDraftRelay(
      {
        type: "resync",
        sessionId: draft.sessionId ?? undefined,
      },
      { fromPlayer: server.username, targetPlayer: room.host, roomId: room.room_id },
    ),
  );
}
