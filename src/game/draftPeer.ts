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
import { draftClockStateSnapshot, draftDecisionRevision } from "@/game/limitedDraftClock";
import {
  saveLimitedPeerDraft,
  saveLimitedPeerClock,
  serializeLimitedSession,
} from "@/game/limitedPersistence";
import { useLimitedDraftClockStore } from "@/stores/useLimitedDraftClockStore";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
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
    void onRelay(payload, myPlayerSlot).catch((error: unknown) => {
      useMultiplayerDraftStore
        .getState()
        .setError(error instanceof Error ? error.message : String(error));
    });
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

async function onRelay(
  payload: { from_player: string; state: RoomRelayEnvelope },
  myPlayerSlot: string,
): Promise<void> {
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
  const receivedAt = Date.now();

  switch (msg.type) {
    case "start":
      handleStart(msg, env, myPlayerSlot);
      return;
    case "stateUpdate":
      if (env.targetPlayer !== myPlayerSlot) return;
      await handleStateUpdate(msg);
      return;
    case "clockState":
      await serializeLimitedSession(msg.sessionId, async () => {
        const store = useMultiplayerDraftStore.getState();
        const current = useLimitedDraftClockStore.getState().sessions[msg.sessionId];
        if (
          store.sessionId !== msg.sessionId ||
          store.mySeat === null ||
          (current && msg.sequence < current.sequence)
        )
          return;
        const clock = draftClockStateSnapshot(
          { ...msg, serverNowMs: msg.serverNowMs + Date.now() - receivedAt },
          current,
        );
        clock.pickSeconds = store.config?.pickSeconds ?? clock.pickSeconds;
        await saveLimitedPeerClock(msg.sessionId, clock, store.mySeat);
        if (useMultiplayerDraftStore.getState().sessionId === msg.sessionId)
          useLimitedDraftClockStore.getState().setClock(clock);
      });
      return;
    case "clockNomination":
      if (env.targetPlayer !== myPlayerSlot) return;
      await serializeLimitedSession(msg.sessionId, async () => {
        const clock = useLimitedDraftClockStore.getState().sessions[msg.sessionId];
        const store = useMultiplayerDraftStore.getState();
        if (
          !clock ||
          store.sessionId !== msg.sessionId ||
          store.mySeat !== msg.seat ||
          !clock.seats.some((seat) => seat.seat === msg.seat && seat.revision === msg.revision)
        )
          return;
        const next = {
          ...clock,
          seats: clock.seats.map((seat) =>
            seat.seat === msg.seat && seat.revision === msg.revision
              ? { ...seat, nominatedId: msg.cardId }
              : seat,
          ),
        };
        await saveLimitedPeerClock(msg.sessionId, next, msg.seat);
        if (useMultiplayerDraftStore.getState().sessionId === msg.sessionId)
          useLimitedDraftClockStore.getState().setClock(next);
      });
      return;
    case "pick":
    case "resync":
    case "clockSync":
    case "clockExpired":
    case "nominate":
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
      revision: 0,
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

async function handleStateUpdate(msg: DraftStateBroadcastMessage): Promise<void> {
  await serializeLimitedSession(msg.sessionId, async () => {
    const store = useMultiplayerDraftStore.getState();
    if (
      store.sessionId !== msg.sessionId ||
      msg.state.sessionId !== msg.sessionId ||
      store.mySeat !== msg.seat ||
      !store.config ||
      !store.roomId
    )
      return;
    if (store.state && msg.state.revision < store.state.revision) return;
    await saveLimitedPeerDraft(msg.state, {
      roomId: store.roomId,
      config: store.config,
      seats: store.seats,
      mySeat: msg.seat,
      history: msg.history,
    });
    if (useMultiplayerDraftStore.getState().sessionId !== msg.sessionId) return;
    const build = useLimitedBuildStore.getState();
    const pending = build.pendingPicks[msg.sessionId];
    if (
      pending &&
      msg.history?.some(
        (decision) =>
          decision.automatic &&
          decision.selectedIds.includes(pending.id) &&
          !store.state?.pickedPile.some((card) => card.id === pending.id),
      )
    )
      build.cancelPick(msg.sessionId, pending.id);
    store.setLocalState(msg.state);
  });
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
    revision: draftDecisionRevision(store.state!),
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
