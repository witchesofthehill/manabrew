import { fetchCubePool, fetchSetPool } from "@/api/limitedEdition";
import {
  type DraftPickMessage,
  type DraftStartMessage,
  type DraftStateBroadcastMessage,
  type MpDraftConfig,
  type MpDraftSeatAssignment,
  isDraftRelay,
  makeDraftRelay,
} from "@/game/draftRelay";
import { getPlatform } from "@/platform";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useServerStore } from "@/stores/useServerStore";
import { registerLimitedSession } from "@/game/limitedSession";
import type { DraftCard, DraftState, LimitedDeck } from "@/types/limited";
import type { RoomRelayEnvelope } from "@/types/server";
export interface DraftHostParticipant {
  playerSlot: string;
  displayName: string;
  isBot?: boolean;
}
export type DraftHostStartResult =
  | {
      ok: true;
      sessionId: string;
      seats: MpDraftSeatAssignment[];
    }
  | {
      ok: false;
      error: string;
    };
interface ActiveHost {
  sessionId: string;
  roomId: string;
  seats: MpDraftSeatAssignment[];
  mySeat: number;
  hostSlot: string;
  unsubscribe: () => void;
  pendingChain: Promise<void>;
  config: MpDraftConfig;
  complete: boolean;
}
let active: ActiveHost | null = null;
function buildSeatAssignments(
  hostSlot: string,
  hostName: string,
  participants: DraftHostParticipant[],
  config: MpDraftConfig,
): MpDraftSeatAssignment[] | null {
  const others = participants.filter((p) => p.playerSlot !== hostSlot);
  const totalParticipants = 1 + others.length;
  if (totalParticipants > config.podSize) return null;
  if (totalParticipants < config.podSize && !config.fillWithBots) return null;
  const seats: MpDraftSeatAssignment[] = [];
  seats.push({ seat: 0, playerSlot: hostSlot, displayName: hostName, isHuman: true });
  others.forEach((p, i) => {
    seats.push({
      seat: i + 1,
      playerSlot: p.playerSlot,
      displayName: p.displayName,
      isHuman: !p.isBot,
    });
  });
  for (let s = totalParticipants; s < config.podSize; s++) {
    seats.push({ seat: s, playerSlot: null, displayName: `AI ${s}`, isHuman: false });
  }
  return seats;
}
export async function startDraftAsHost(args: {
  roomId: string;
  hostSlot: string;
  hostName: string;
  participants: DraftHostParticipant[];
  config: MpDraftConfig;
}): Promise<DraftHostStartResult> {
  if (active) {
    console.warn(
      `[draftHost] stale active session ${active.sessionId} in room ${active.roomId} — tearing down before starting a new one`,
    );
    teardownHost();
  }
  const { roomId, hostSlot, hostName, participants, config } = args;
  const seats = buildSeatAssignments(hostSlot, hostName, participants, config);
  if (!seats) {
    return {
      ok: false,
      error: `The pod needs ${config.podSize} seats but only ${1 + participants.length} participants are ready.`,
    };
  }
  const platform = getPlatform();
  if (!platform.server) {
    return { ok: false, error: "multiplayer not available on this platform" };
  }
  if (!useServerStore.getState().hasRelayFeature("limited_sessions"))
    return { ok: false, error: "Update the relay to use multiplayer Limited sessions." };
  const server = platform.server;
  let pool: DraftCard[];
  try {
    if (config.cubeId) {
      pool = await fetchCubePool(config.cubeId);
    } else if (config.setCode) {
      pool = await fetchSetPool(config.setCode);
    } else {
      return { ok: false, error: "draft config has no pool source (set or cube)" };
    }
  } catch (err) {
    if (config.setCode && String(err).includes("unknown set")) {
      return {
        ok: false,
        error: `your game data doesn't include set ${config.setCode.toUpperCase()} — update the app to draft it`,
      };
    }
    const source = config.cubeId ? `cube ${config.cubeId}` : `set ${config.setCode}`;
    return { ok: false, error: `failed to load ${source}: ${String(err)}` };
  }
  let initialState: DraftState;
  try {
    initialState = await platform.invoke<DraftState>("limited_start_multiplayer_draft", {
      setup: {
        podSize: config.podSize,
        rounds: config.rounds,
        pool,
        picksPerPass: config.picksPerPass,
        customPool: Boolean(config.cubeId),
        seed: config.seed,
      },
      humans: seats.filter((s) => s.isHuman).map((s) => ({ seat: s.seat, name: s.displayName })),
    });
  } catch (err) {
    return { ok: false, error: `engine refused start: ${String(err)}` };
  }
  useMultiplayerDraftStore.getState().enterAsHost({
    sessionId: initialState.sessionId,
    roomId,
    config,
    seats,
    mySeat: 0,
    state: initialState,
  });
  const startMsg: DraftStartMessage = {
    type: "start",
    sessionId: initialState.sessionId,
    config,
    seats,
  };
  const unsubscribe = platform.events.on<{
    from_player: string;
    state: RoomRelayEnvelope;
  }>("server:room_message", (payload) => {
    void onRelay(payload);
  });
  active = {
    sessionId: initialState.sessionId,
    roomId,
    seats,
    mySeat: 0,
    hostSlot,
    config,
    complete: false,
    unsubscribe,
    pendingChain: Promise.resolve(),
  };
  await server.sendRoomMessage(makeDraftRelay(startMsg, { fromPlayer: hostSlot, roomId }));
  await broadcastPerSeatStates(seats, initialState.sessionId, hostSlot, roomId);
  return { ok: true, sessionId: initialState.sessionId, seats };
}
function enqueuePick(
  seat: number,
  card: DraftCard,
  round?: number,
  pickNumber?: number,
): Promise<void> {
  if (!active) return Promise.resolve();
  const next = active.pendingChain
    .catch((err) => {
      console.error("[draftHost] pick chain swallowed error:", err);
    })
    .then(() => applyPick(seat, card, round, pickNumber));
  active.pendingChain = next;
  return next;
}
export function hasLiveDraftHost(): boolean {
  return active !== null;
}
export async function submitHostPick(card: DraftCard): Promise<void> {
  if (!active) return;
  const store = useMultiplayerDraftStore.getState();
  if (store.pickPending) return;
  store.setPickPending(true);
  await enqueuePick(active.mySeat, card, store.state?.round, store.state?.pickNumber);
}
async function onRelay(payload: { from_player: string; state: RoomRelayEnvelope }): Promise<void> {
  if (!active) return;
  if (!isDraftRelay(payload.state)) return;
  const env = payload.state;
  const session = active;
  if (
    env.roomId !== session.roomId ||
    env.fromPlayer !== payload.from_player ||
    env.targetPlayer !== session.hostSlot
  )
    return;
  const seat = session.seats.find((s) => s.playerSlot === payload.from_player && s.isHuman);
  if (!seat || (env.payload.sessionId && env.payload.sessionId !== session.sessionId)) return;
  if (env.payload.type === "resync") {
    await getPlatform().server?.sendRoomMessage(
      makeDraftRelay(
        {
          type: "start",
          sessionId: session.sessionId,
          config: session.config,
          seats: session.seats,
        },
        { fromPlayer: session.hostSlot, roomId: session.roomId, targetPlayer: payload.from_player },
      ),
    );
    await broadcastPerSeatStates([seat], session.sessionId, session.hostSlot, session.roomId);
    return;
  }
  if (env.payload.type !== "pick" || session.complete) return;
  const pick = env.payload as DraftPickMessage;
  const state = await fetchSeatState(session.sessionId, seat.seat);
  const card = state?.currentPack.find((candidate) => candidate.id === pick.cardId);
  if (!card) {
    await broadcastPerSeatStates([seat], session.sessionId, session.hostSlot, session.roomId);
    return;
  }
  await enqueuePick(seat.seat, card, pick.round, pick.pickNumber);
}
async function applyPick(
  seat: number,
  card: DraftCard,
  round?: number,
  pickNumber?: number,
): Promise<void> {
  if (!active) return;
  const session = active;
  const platform = getPlatform();
  if (round !== undefined && pickNumber !== undefined) {
    const current = await fetchSeatState(session.sessionId, seat);
    if (current && (current.round !== round || current.pickNumber !== pickNumber)) {
      console.warn(
        `[draftHost] dropping stale pick "${card.name}" from seat ${seat} — sent at round ${round} pick ${pickNumber}, seat is now at round ${current.round} pick ${current.pickNumber}`,
      );
      if (seat === session.mySeat) useMultiplayerDraftStore.getState().setPickPending(false);
      return;
    }
  }
  let nextState: DraftState;
  try {
    nextState = await platform.invoke<DraftState>("limited_submit_pick", {
      sessionId: session.sessionId,
      seatIdx: seat,
      cardId: card.id,
    });
  } catch (err) {
    useMultiplayerDraftStore.getState().setError(`pick failed: ${String(err)}`);
    if (seat === session.mySeat) useMultiplayerDraftStore.getState().setPickPending(false);
    await broadcastPerSeatStates(
      session.seats,
      session.sessionId,
      session.hostSlot,
      session.roomId,
    );
    return;
  }
  if (seat === session.mySeat) {
    useMultiplayerDraftStore.getState().setLocalState(nextState);
  } else {
    const hostState = await fetchSeatState(session.sessionId, session.mySeat);
    if (hostState) useMultiplayerDraftStore.getState().setLocalState(hostState);
  }
  await broadcastPerSeatStates(session.seats, session.sessionId, session.hostSlot, session.roomId);
  if (nextState.isComplete) {
    await finishDraft();
  }
}
async function broadcastPerSeatStates(
  seats: MpDraftSeatAssignment[],
  sessionId: string,
  fromPlayer: string,
  roomId: string,
): Promise<void> {
  const server = getPlatform().server;
  if (!server) return;
  const targets = seats.filter((s) => s.playerSlot !== null && s.playerSlot !== fromPlayer);
  if (targets.length === 0) return;
  const states = await Promise.all(targets.map((s) => fetchSeatState(sessionId, s.seat)));
  await Promise.all(
    targets.map((s, i) => {
      const seatState = states[i];
      if (!seatState) return Promise.resolve();
      const msg: DraftStateBroadcastMessage = {
        type: "stateUpdate",
        sessionId,
        seat: s.seat,
        state: seatState,
      };
      return server.sendRoomMessage(
        makeDraftRelay(msg, {
          fromPlayer,
          targetPlayer: s.playerSlot ?? undefined,
          roomId,
        }),
      );
    }),
  );
}
async function fetchSeatState(sessionId: string, seat: number): Promise<DraftState | null> {
  try {
    return await getPlatform().invoke<DraftState>("limited_get_seat_state", {
      sessionId,
      seatIdx: seat,
    });
  } catch (err) {
    console.warn(`[draftHost] seat ${seat} state failed:`, err);
    return null;
  }
}
async function finishDraft(): Promise<void> {
  if (!active || active.complete) return;
  const session = active;
  const room = useServerStore.getState().currentRoom;
  if (!room || room.room_id !== session.roomId) return;
  const aiDecks = await getPlatform().invoke<Array<{ seat: number; deck: LimitedDeck }>>(
    "limited_get_draft_ai_decks",
    { sessionId: session.sessionId },
  );
  const pools = await Promise.all(
    session.seats.map(async (s) => {
      const state = await fetchSeatState(session.sessionId, s.seat);
      if (!state) throw new Error(`Seat ${s.seat} pool is unavailable.`);
      const deck = aiDecks.find((entry) => entry.seat === s.seat)?.deck;
      return {
        seat: s.seat,
        pool: state.pickedPile,
        build: deck ? { main: deck.main, sideboard: deck.sideboard } : null,
      };
    }),
  );
  session.complete = true;
  await registerLimitedSession({
    kind: "draft",
    sessionId: session.sessionId,
    room,
    seats: session.seats,
    pools,
  });
}
export function teardownHost(signalEnd = false): void {
  if (!active) return;
  active.unsubscribe();
  const { sessionId } = active;
  active = null;
  void getPlatform()
    .invoke("limited_drop_session", { kind: "draft", sessionId })
    .catch((err) => {
      console.warn("[draftHost] limited_drop_session failed:", err);
    });
  if (signalEnd) {
    void useServerStore
      .getState()
      .endGame()
      .catch((err) => {
        console.warn("[draftHost] endGame on teardown failed:", err);
      });
  }
}
