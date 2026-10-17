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
import { commitLimitedEngineSession, serializeLimitedSession } from "@/game/limitedPersistence";
import { captureLimitedConnection } from "@/game/limitedConnection";
import { readLimitedSave } from "@/game/limitedStorage";
import {
  configureDraftClock,
  draftDecisionRevision,
  exportDraftClock,
  restoreDraftClock,
  syncDraftClocks,
  publishDraftClocks,
  disposeDraftClock,
} from "@/game/limitedDraftClock";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import type { LimitedSavedSession } from "@/game/limitedPersistence.types";
import type { LimitedDraftDecision } from "@/types/limited";
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
  config: MpDraftConfig;
  complete: boolean;
  acceptedRequests: Set<string>;
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
  if (!useServerStore.getState().hasRelayFeature("limited_session_recovery"))
    return { ok: false, error: "Update the relay to use durable multiplayer Limited sessions." };
  const server = platform.server;
  if (config.pickSeconds && !useServerStore.getState().hasRelayFeature("limited_draft_clocks"))
    return { ok: false, error: "Update the relay to use timed Booster Draft." };
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
  await commitLimitedEngineSession("draft", initialState.sessionId, initialState, {
    role: "host",
    seat: 0,
    draftHost: { roomId, hostSlot, config, seats, mySeat: 0, complete: false },
    connection: useServerStore.getState().currentRoom
      ? captureLimitedConnection(useServerStore.getState().currentRoom!, initialState.sessionId)
      : undefined,
  });
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
    acceptedRequests: new Set(),
  };
  configureHostClock();
  await syncHostClocks();
  await persistHostDraft(initialState);
  await server.sendRoomMessage(makeDraftRelay(startMsg, { fromPlayer: hostSlot, roomId }));
  await broadcastPerSeatStates(seats, initialState.sessionId, hostSlot, roomId);
  await publishDraftClocks(initialState.sessionId);
  return { ok: true, sessionId: initialState.sessionId, seats };
}
function enqueuePick(
  seat: number,
  card: DraftCard,
  round?: number,
  pickNumber?: number,
): Promise<void> {
  if (!active) return Promise.resolve();
  const session = active;
  const next = serializeLimitedSession(session.sessionId, async () => {
    if (active === session) await applyPick(seat, card, round, pickNumber);
  });
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
  await serializeLimitedSession(session.sessionId, async () => {
    if (active !== session) return;
    if (env.payload.type === "resync") {
      await getPlatform().server?.sendRoomMessage(
        makeDraftRelay(
          {
            type: "start",
            sessionId: session.sessionId,
            config: session.config,
            seats: session.seats,
          },
          {
            fromPlayer: session.hostSlot,
            roomId: session.roomId,
            targetPlayer: payload.from_player,
          },
        ),
      );
      await broadcastPerSeatStates([seat], session.sessionId, session.hostSlot, session.roomId);
      return;
    }
    if (env.payload.type !== "pick" || session.complete) return;
    const pick = env.payload as DraftPickMessage;
    const state = await fetchSeatState(session.sessionId, seat.seat);
    if (active !== session) return;
    const card = state?.currentPack.find((candidate) => candidate.id === pick.cardId);
    if (!card) {
      await broadcastPerSeatStates([seat], session.sessionId, session.hostSlot, session.roomId);
      return;
    }
    if (session.acceptedRequests.has(env.messageId)) {
      await broadcastPerSeatStates([seat], session.sessionId, session.hostSlot, session.roomId);
      return;
    }
    await applyPick(seat.seat, card, pick.round, pick.pickNumber, env.messageId);
  });
}
async function applyPick(
  seat: number,
  card: DraftCard,
  round?: number,
  pickNumber?: number,
  requestId?: string,
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
  const previous = await readLimitedSave(session.sessionId);
  if (requestId) session.acceptedRequests.add(requestId);
  try {
    nextState = await platform.invoke<DraftState>("limited_submit_pick", {
      sessionId: session.sessionId,
      seatIdx: seat,
      cardId: card.id,
    });
    await syncHostClocks();
    const hostState =
      seat === session.mySeat ? nextState : await fetchSeatState(session.sessionId, session.mySeat);
    if (!hostState) throw new Error("The host's draft state is unavailable.");
    await persistHostDraft(hostState);
  } catch (err) {
    if (requestId) session.acceptedRequests.delete(requestId);
    if (previous?.checkpoint)
      await platform.invoke("limited_import_session", { checkpoint: previous.checkpoint });
    if (previous?.clock) {
      configureHostClock(previous);
      await syncHostClocks();
    }
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
  await publishDraftClocks(session.sessionId);
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
  const histories = await Promise.all(
    targets.map((s) =>
      getPlatform().invoke<LimitedDraftDecision[]>("limited_get_draft_review", {
        kind: "draft",
        sessionId,
        seat: s.seat,
      }),
    ),
  );
  await Promise.all(
    targets.map((s, i) => {
      const seatState = states[i];
      if (!seatState) return Promise.resolve();
      const msg: DraftStateBroadcastMessage = {
        type: "stateUpdate",
        sessionId,
        seat: s.seat,
        state: seatState,
        history: histories[i],
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
  const saved = await readLimitedSave(session.sessionId);
  if (!saved?.hostSession) {
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
    await registerLimitedSession({
      kind: "draft",
      sessionId: session.sessionId,
      room,
      seats: session.seats,
      pools,
    });
  }
  session.complete = true;
  const ownState = await fetchSeatState(session.sessionId, session.mySeat);
  if (ownState) await persistHostDraft(ownState);
}
export function teardownHost(signalEnd = false): void {
  if (!active) return;
  active.unsubscribe();
  disposeDraftClock(active.sessionId);
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

async function persistHostDraft(state: DraftState): Promise<void> {
  if (!active) throw new Error("No draft host is active.");
  if (state.sessionId !== active.sessionId)
    throw new Error("The active draft changed before it could be saved.");
  const { sessionId, roomId, hostSlot, seats, mySeat, config, complete, acceptedRequests } = active;
  await commitLimitedEngineSession("draft", sessionId, state, {
    role: "host",
    seat: mySeat,
    draftHost: { roomId, hostSlot, seats, mySeat, config, complete },
    acceptedRequests: [...acceptedRequests],
  });
}

async function syncHostClocks(): Promise<void> {
  if (!active) return;
  const session = active;
  const states = await Promise.all(
    session.seats
      .filter((seat) => seat.isHuman)
      .map(async (seat) => {
        const state = await fetchSeatState(session.sessionId, seat.seat);
        if (!state) throw new Error(`Seat ${seat.seat} is unavailable.`);
        return { seat: seat.seat, state };
      }),
  );
  syncDraftClocks(session.sessionId, states);
}

function configureHostClock(saved?: LimitedSavedSession): void {
  if (!active) return;
  const session = active;
  const options = {
    sessionId: session.sessionId,
    pickSeconds: session.config.pickSeconds,
    enqueue: <T>(operation: () => Promise<T>) =>
      serializeLimitedSession(session.sessionId, operation),
    onTimeout: (seat: number, revision: string, cardId?: string, clockSequence?: number) =>
      submitHostAutomaticPick(seat, cardId, revision, clockSequence),
    onChange: async () => {
      if (active !== session) throw new Error("This draft host is no longer active.");
      const state = await fetchSeatState(session.sessionId, session.mySeat);
      if (!state) throw new Error("The host's draft state is unavailable.");
      await persistHostDraft(state);
    },
    relay: { roomId: session.roomId, hostSlot: session.hostSlot, seats: session.seats },
  };
  if (saved?.clock) restoreDraftClock(saved.clock, options);
  else configureDraftClock(options);
}

export async function restoreDraftHost(saved: LimitedSavedSession): Promise<void> {
  const metadata = saved.draftHost;
  if (!metadata || !saved.state || saved.kind !== "draft")
    throw new Error("Saved draft host metadata is missing.");
  active?.unsubscribe();
  active = {
    ...metadata,
    complete: Boolean(saved.hostSession),
    sessionId: saved.sessionId,
    acceptedRequests: new Set(saved.acceptedRequests ?? []),
    unsubscribe: getPlatform().events.on<{ from_player: string; state: RoomRelayEnvelope }>(
      "server:room_message",
      (payload) => {
        void onRelay(payload);
      },
    ),
  };
  useMultiplayerDraftStore
    .getState()
    .enterAsHost({ ...metadata, sessionId: saved.sessionId, state: saved.state as DraftState });
  if (active.complete) useMultiplayerDraftStore.getState().complete();
  configureHostClock(saved);
  await syncHostClocks();
  await persistHostDraft(saved.state as DraftState);
  await getPlatform().server?.sendRoomMessage(
    makeDraftRelay(
      { type: "start", sessionId: saved.sessionId, config: active.config, seats: active.seats },
      { fromPlayer: active.hostSlot, roomId: active.roomId },
    ),
  );
  await broadcastPerSeatStates(active.seats, saved.sessionId, active.hostSlot, active.roomId);
  await publishDraftClocks(saved.sessionId);
  if ((saved.state as DraftState).isComplete && !active.complete) await finishDraft();
}

export async function submitHostAutomaticPick(
  seat: number,
  cardId?: string,
  revision?: string,
  clockSequence?: number,
): Promise<void> {
  if (!active) return;
  const session = active;
  await serializeLimitedSession(session.sessionId, async () => {
    const clock = exportDraftClock(session.sessionId);
    if (
      revision &&
      (!clock || clock.paused || (clockSequence !== undefined && clock.sequence !== clockSequence))
    )
      return;
    const nominatedId = revision
      ? (clock?.seats.find((entry) => entry.seat === seat)?.nominatedId ?? undefined)
      : cardId;
    const state = await fetchSeatState(session.sessionId, seat);
    if (
      !state?.awaitingHuman ||
      session.complete ||
      (revision && draftDecisionRevision(state) !== revision)
    )
      return;
    const previous = await readLimitedSave(session.sessionId);
    const pending = useLimitedBuildStore.getState().pendingPicks[session.sessionId];
    if (seat === session.mySeat && pending)
      useLimitedBuildStore.getState().cancelPick(session.sessionId, pending.id);
    let committed = false;
    try {
      const next = await getPlatform().invoke<DraftState>("limited_auto_pick", {
        sessionId: session.sessionId,
        seat,
        cardId: nominatedId,
      });
      await syncHostClocks();
      const own =
        seat === session.mySeat ? next : await fetchSeatState(session.sessionId, session.mySeat);
      if (!own) throw new Error("The host's draft state is unavailable.");
      await persistHostDraft(own);
      committed = true;
      useMultiplayerDraftStore.getState().setLocalState(own);
      await broadcastPerSeatStates(
        session.seats,
        session.sessionId,
        session.hostSlot,
        session.roomId,
      );
      await publishDraftClocks(session.sessionId);
      if (next.isComplete) await finishDraft();
    } catch (error) {
      if (!committed && previous?.checkpoint) {
        await getPlatform().invoke("limited_import_session", { checkpoint: previous.checkpoint });
        if (previous.clock) {
          configureHostClock(previous);
          await syncHostClocks();
        }
      }
      throw error;
    }
  });
}
