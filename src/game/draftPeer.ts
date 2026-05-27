// SPDX-License-Identifier: GPL-3.0-or-later
//
// Peer-side relay listener for multiplayer booster drafts. The host
// owns the engine session (see `draftHost.ts`); peers just receive
// per-seat state broadcasts and forward their picks back to the host
// over the same RoomRelayEnvelope channel.
//
// A peer "is in a draft" iff `useMultiplayerDraftStore.mode ===
// "drafting"` and they were addressed by a `DraftStartMessage`. The
// listener stays attached for the lifetime of the lobby/draft view so
// re-entering a draft after disconnect/reconnect picks up cleanly.

import {
  type DraftPickMessage,
  type DraftStartMessage,
  type DraftStateBroadcastMessage,
  isDraftRelay,
  makeDraftRelay,
} from "@/game/draftRelay";
import { getPlatform } from "@/platform";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import type { RoomRelayEnvelope } from "@/types/server";

let active: { unsubscribe: () => void; myPlayerSlot: string } | null = null;

/**
 * Attach the relay listener for a peer client. Should be called once
 * the local player knows their server slot (after `Authenticate` /
 * `RoomCreated` / `JoinRoom` lands). Returns a teardown function the
 * caller can use for `useEffect` cleanup.
 */
export function attachDraftPeer(myPlayerSlot: string): () => void {
  if (active && active.myPlayerSlot === myPlayerSlot) {
    return active.unsubscribe;
  }
  if (active) {
    active.unsubscribe();
  }
  const platform = getPlatform();
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
  const msg = env.payload;
  const store = useMultiplayerDraftStore.getState();

  switch (msg.type) {
    case "start":
      handleStart(msg, env, myPlayerSlot);
      return;
    case "stateUpdate":
      if (env.targetPlayer && env.targetPlayer !== myPlayerSlot) return;
      handleStateUpdate(msg);
      return;
    case "complete":
      // Both host (who sent it) and every other peer arrives here;
      // the host's `finishDraft()` already wrote to the store, so a
      // duplicate write is harmless idempotent.
      store.complete(
        msg.picks.map((p) => ({
          seat: p.seat,
          playerSlot: p.playerSlot,
          displayName: p.displayName,
          isHuman: p.isHuman,
          pool: p.pool,
        })),
      );
      return;
    case "pick":
      // Picks are host-bound; peers ignore them as they fly past.
      return;
  }
}

function handleStart(msg: DraftStartMessage, env: RoomRelayEnvelope, myPlayerSlot: string): void {
  const mySeat = msg.seats.find((s) => s.playerSlot === myPlayerSlot);
  if (!mySeat) {
    // The local client is in the room but wasn't seated — observer
    // mode, future feature. For now drop the event silently.
    return;
  }
  const store = useMultiplayerDraftStore.getState();
  // The state for our seat lands separately via a `stateUpdate`
  // envelope; until then render a placeholder by stashing config +
  // seats but leaving `state: null`.
  store.enterAsPeer({
    sessionId: msg.sessionId,
    roomId: env.roomId ?? "",
    config: msg.config,
    seats: msg.seats,
    mySeat: mySeat.seat,
    // Placeholder — replaced by the next stateUpdate before the user
    // can pick anything.
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
  if (store.sessionId !== msg.sessionId) return;
  if (store.mySeat !== msg.seat) return;
  store.setLocalState(msg.state);
}

/**
 * Peer's pick path. Sends a `DraftPickMessage` to the host (addressed
 * by the host's player slot, derived from the seat assignment list).
 * The host applies the pick to the engine, then ships an updated
 * `DraftStateBroadcastMessage` back which lands in
 * `handleStateUpdate`.
 */
export async function submitPeerPick(cardName: string): Promise<void> {
  const store = useMultiplayerDraftStore.getState();
  if (!store.sessionId || store.mySeat == null || store.amHost) return;
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
    cardName,
  };
  await server.sendRoomMessage(
    makeDraftRelay(msg, {
      fromPlayer: myPlayerSlot,
      targetPlayer: hostSlot,
      roomId: store.roomId ?? undefined,
    }),
  );
}
