import { fetchCubePool, fetchSetPool } from "@/api/limitedEdition";
import {
  type DraftPickMessage,
  type DraftStartMessage,
  type DraftStateBroadcastMessage,
  type DraftCompleteMessage,
  type MpDraftConfig,
  type MpDraftSeatAssignment,
  isDraftRelay,
  makeDraftRelay,
} from "@/game/draftRelay";
import { getPlatform } from "@/platform";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useServerStore } from "@/stores/useServerStore";
import type { DraftCard, DraftState } from "@/types/limited";
import type { RoomRelayEnvelope } from "@/types/server";

export interface DraftHostParticipant {
  playerSlot: string;
  displayName: string;
}

export type DraftHostStartResult =
  | { ok: true; sessionId: string; seats: MpDraftSeatAssignment[] }
  | { ok: false; error: string };

interface ActiveHost {
  sessionId: string;
  roomId: string;
  seats: MpDraftSeatAssignment[];
  mySeat: number;
  hostSlot: string;
  unsubscribe: () => void;
  pendingChain: Promise<void>;
}

let active: ActiveHost | null = null;

function buildSeatAssignments(
  hostSlot: string,
  hostName: string,
  participants: DraftHostParticipant[],
  config: MpDraftConfig,
): MpDraftSeatAssignment[] | null {
  const others = participants.filter((p) => p.playerSlot !== hostSlot);
  const totalHumans = 1 + others.length;
  if (totalHumans > config.podSize) return null;
  if (totalHumans < config.podSize && !config.fillWithBots) return null;

  const seats: MpDraftSeatAssignment[] = [];
  seats.push({ seat: 0, playerSlot: hostSlot, displayName: hostName, isHuman: true });
  others.forEach((p, i) => {
    seats.push({
      seat: i + 1,
      playerSlot: p.playerSlot,
      displayName: p.displayName,
      isHuman: true,
    });
  });
  for (let s = totalHumans; s < config.podSize; s++) {
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
      error: `pod needs ${config.podSize} seats but only ${
        1 + participants.length
      } humans are ready`,
    };
  }
  const platform = getPlatform();
  if (!platform.server) {
    return { ok: false, error: "multiplayer not available on this platform" };
  }
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
  await server.sendRoomMessage(makeDraftRelay(startMsg, { fromPlayer: hostSlot, roomId }));
  await broadcastPerSeatStates(seats, initialState.sessionId, hostSlot, roomId);

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
    unsubscribe,
    pendingChain: Promise.resolve(),
  };

  return { ok: true, sessionId: initialState.sessionId, seats };
}

function enqueuePick(
  seat: number,
  cardName: string,
  round?: number,
  pickNumber?: number,
): Promise<void> {
  if (!active) return Promise.resolve();
  const next = active.pendingChain
    .catch((err) => {
      console.error("[draftHost] pick chain swallowed error:", err);
    })
    .then(() => applyPick(seat, cardName, round, pickNumber));
  active.pendingChain = next;
  return next;
}

export async function submitHostPick(cardName: string): Promise<void> {
  if (!active) return;
  const store = useMultiplayerDraftStore.getState();
  if (store.pickPending) return;
  store.setPickPending(true);
  await enqueuePick(active.mySeat, cardName, store.state?.round, store.state?.pickNumber);
}

async function onRelay(payload: { from_player: string; state: RoomRelayEnvelope }): Promise<void> {
  if (!active) return;
  if (!isDraftRelay(payload.state)) return;
  const env = payload.state;
  if (env.payload.type !== "pick") return;
  if (env.payload.sessionId !== active.sessionId) return;
  const pick = env.payload as DraftPickMessage;
  const seat = active.seats.find((s) => s.playerSlot === payload.from_player);
  if (!seat) {
    console.warn("[draftHost] pick from unknown player", payload.from_player);
    return;
  }
  await enqueuePick(seat.seat, pick.cardName, pick.round, pick.pickNumber);
}

async function applyPick(
  seat: number,
  cardName: string,
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
        `[draftHost] dropping stale pick "${cardName}" from seat ${seat} — sent at round ${round} pick ${pickNumber}, seat is now at round ${current.round} pick ${current.pickNumber}`,
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
      cardName,
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
  if (!active) return;
  const session = active;
  const server = getPlatform().server;
  const pools = await Promise.all(
    session.seats.map(async (s) => {
      const state = await fetchSeatState(session.sessionId, s.seat);
      return {
        seat: s.seat,
        playerSlot: s.playerSlot,
        displayName: s.displayName,
        isHuman: s.isHuman,
        pool: state?.pickedPile ?? [],
      };
    }),
  );
  useMultiplayerDraftStore.getState().complete(pools);
  const msg: DraftCompleteMessage = {
    type: "complete",
    sessionId: session.sessionId,
    picks: pools,
  };
  if (server) {
    await server.sendRoomMessage(
      makeDraftRelay(msg, {
        fromPlayer: session.hostSlot,
        roomId: session.roomId,
      }),
    );
  }
  try {
    await useServerStore.getState().endGame();
  } catch (err) {
    console.warn("[draftHost] endGame after finishDraft failed:", err);
  }
  teardownHost();
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
