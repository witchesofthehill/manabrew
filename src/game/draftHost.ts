// SPDX-License-Identifier: GPL-3.0-or-later
//
// Host-side coordination for a multiplayer booster draft. The room
// host runs the actual `BoosterDraft` engine session in their WASM /
// Tauri backend; this module:
//   1. starts the engine session with seat assignments,
//   2. broadcasts the start event to every peer (with their seat
//      assignment + initial draft state),
//   3. receives incoming peer picks via the RoomRelay event bus,
//      submits them to the engine, and re-broadcasts each peer's
//      updated per-seat view,
//   4. detects draft completion and broadcasts every player's final
//      pool so peers can navigate to the build/completion view.
//
// All wire traffic rides on `RoomRelayEnvelope` with protocol
// "draft-v1"; the matchmaking server is a dumb relay. If the host
// disconnects mid-draft the session dies — same model as the existing
// multiplayer game flow.

import { fetchSetPool } from "@/api/limitedEdition";
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

/** One non-host participant the host knows about at draft start. */
export interface DraftHostParticipant {
  /** Server-side identifier (`player-N`) for the peer. */
  playerSlot: string;
  /** Display name shown in the seat summary. */
  displayName: string;
}

/** Outcome of `startDraftAsHost` so the caller can show a useful error
 *  without parsing `Error.message`. */
export type DraftHostStartResult =
  | { ok: true; sessionId: string; seats: MpDraftSeatAssignment[] }
  | { ok: false; error: string };

interface ActiveHost {
  sessionId: string;
  roomId: string;
  seats: MpDraftSeatAssignment[];
  mySeat: number;
  /** The host's own server slot — pinned here so the broadcast paths
   *  don't need to re-derive it from `seats[0].playerSlot` (whose type
   *  is `string | null` since bot seats live in the same array). */
  hostSlot: string;
  /** Subscriber returned by `events.on` — call to detach the listener. */
  unsubscribe: () => void;
  /** Serialises `applyPick` invocations against concurrent peer
   *  picks. `onRelay` fires-and-forgets each incoming envelope, and
   *  with `picksPerPass > 1` (or fast clickers) two picks can land
   *  inside the same engine tick. The engine itself is single-
   *  threaded inside wasm, but the per-seat state fetches that
   *  follow each await can interleave and broadcast stale views to
   *  peers. Chaining every pick through this promise guarantees one
   *  full apply + broadcast cycle finishes before the next starts. */
  pendingChain: Promise<void>;
}

// Module-level singleton — assumes one host session per tab at a
// time. Observer mode and concurrent draft+game would need a
// per-session ref keyed by roomId; out of scope for v1.
let active: ActiveHost | null = null;

/**
 * Allocate seats for the room. The host always sits at seat 0; the
 * other participants take seats 1..N. Remaining slots become AI bots
 * if `fillWithBots`, otherwise the function rejects with `null` so the
 * lobby can keep the room open until more humans join.
 *
 * Internal — exposed module-locally only; if you need to construct
 * seats outside of `startDraftAsHost`, lift this to `export` together
 * with whatever orchestration replaces it.
 */
function buildSeatAssignments(
  hostSlot: string,
  hostName: string,
  participants: DraftHostParticipant[],
  config: MpDraftConfig,
): MpDraftSeatAssignment[] | null {
  const totalHumans = 1 + participants.length;
  if (totalHumans > config.podSize) return null;
  if (totalHumans < config.podSize && !config.fillWithBots) return null;

  const seats: MpDraftSeatAssignment[] = [];
  seats.push({ seat: 0, playerSlot: hostSlot, displayName: hostName, isHuman: true });
  participants.forEach((p, i) => {
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

/**
 * Kick off a multiplayer draft on the host. Pulls the set pool,
 * starts the engine session, then broadcasts the start envelope plus
 * every peer's initial per-seat state. Sets up the relay listener so
 * subsequent peer picks land on the engine.
 *
 * Returns the engine session id (the host stores this so it can
 * address the same draft through the worker dispatch). Throws no
 * exceptions — failures come back as `{ ok: false, error }`.
 */
export async function startDraftAsHost(args: {
  roomId: string;
  hostSlot: string;
  hostName: string;
  participants: DraftHostParticipant[];
  config: MpDraftConfig;
}): Promise<DraftHostStartResult> {
  if (active) {
    return { ok: false, error: "a draft is already in progress on this host" };
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
    pool = await fetchSetPool(config.setCode);
  } catch (err) {
    return { ok: false, error: `failed to load set ${config.setCode}: ${String(err)}` };
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

  // Update local store first so the host's own UI flips immediately.
  useMultiplayerDraftStore.getState().enterAsHost({
    sessionId: initialState.sessionId,
    roomId,
    config,
    seats,
    mySeat: 0,
    state: initialState,
  });

  // Broadcast start to the room and seed every peer with their view.
  const startMsg: DraftStartMessage = {
    type: "start",
    sessionId: initialState.sessionId,
    config,
    seats,
  };
  await server.sendRoomMessage(makeDraftRelay(startMsg, { fromPlayer: hostSlot, roomId }));
  await broadcastPerSeatStates(seats, initialState.sessionId, hostSlot, roomId);

  // Subscribe to incoming picks. Stash the unsubscribe handle so
  // `teardownHost` can detach it on draft end / disconnect.
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

/**
 * Enqueue a pick through the host's serialisation chain so concurrent
 * peer picks (or peer + host picks landing in the same tick) apply
 * one at a time. Errors are logged + swallowed into the chain so a
 * failing pick doesn't poison subsequent submissions; user-facing
 * errors still land on the store via `applyPick`'s `setError`.
 */
function enqueuePick(seat: number, cardName: string): Promise<void> {
  if (!active) return Promise.resolve();
  const next = active.pendingChain
    .catch((err) => {
      // `applyPick` already piped the user-facing error to the store
      // via `setError`. Log to console for synchronous throws that
      // don't go through that path (e.g. unexpected `getPlatform()`
      // failures) so they aren't completely silent.
      console.error("[draftHost] pick chain swallowed error:", err);
    })
    .then(() => applyPick(seat, cardName));
  active.pendingChain = next;
  return next;
}

/**
 * Host's own pick path — same engine call as a peer pick but routed
 * locally instead of off-room. Mirrors `peer.submitPick` so the host's
 * own DraftCardTile clicks land on the engine identically.
 */
export async function submitHostPick(cardName: string): Promise<void> {
  if (!active) return;
  await enqueuePick(active.mySeat, cardName);
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
  await enqueuePick(seat.seat, pick.cardName);
}

async function applyPick(seat: number, cardName: string): Promise<void> {
  if (!active) return;
  const platform = getPlatform();
  let nextState: DraftState;
  try {
    nextState = await platform.invoke<DraftState>("limited_submit_pick", {
      sessionId: active.sessionId,
      seatIdx: seat,
      cardName,
    });
  } catch (err) {
    useMultiplayerDraftStore.getState().setError(`pick failed: ${String(err)}`);
    return;
  }

  // Refresh the host's own view; for everybody else, fetch their
  // per-seat state and ship it via relay.
  if (seat === active.mySeat) {
    useMultiplayerDraftStore.getState().setLocalState(nextState);
  } else {
    // Host needs their own seat's fresh view too (the pick advanced
    // the round / passed packs).
    const hostState = await fetchSeatState(active.sessionId, active.mySeat);
    if (hostState) useMultiplayerDraftStore.getState().setLocalState(hostState);
  }

  await broadcastPerSeatStates(active.seats, active.sessionId, active.hostSlot, active.roomId);

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
  // Only human peer seats need a broadcast: skip the host's own seat
  // (state already in local store) and any bot seat (no remote
  // viewer to relay to).
  const targets = seats.filter((s) => s.playerSlot !== null && s.playerSlot !== fromPlayer);
  if (targets.length === 0) return;
  // Fetch every seat's state in parallel; the engine reads are cheap
  // local calls but serializing them used to add `O(N)` latency per
  // pick. Send order doesn't matter because each envelope is
  // self-contained and `targetPlayer`-addressed.
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

/** Wrap up the session: broadcast every pool, flip the local store
 *  into `complete`, signal the matchmaking server to reset the room,
 *  and detach.
 *
 *  By construction this runs *inside* the active `pendingChain` link
 *  (called from `applyPick` after the engine signals `isComplete`), so
 *  there is no need to `await active.pendingChain` here — that would
 *  deadlock. Any peer picks that arrive while `finishDraft` is mid-
 *  await get queued onto the chain via `enqueuePick`; after teardown
 *  sets `active = null`, those queued links bail at `applyPick`'s
 *  `if (!active) return` guard, so the wasm session never sees a
 *  post-complete `limited_submit_pick`. */
async function finishDraft(): Promise<void> {
  if (!active) return;
  const server = getPlatform().server;
  const pools = await Promise.all(
    active.seats.map(async (s) => {
      const state = await fetchSeatState(active!.sessionId, s.seat);
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
    sessionId: active.sessionId,
    picks: pools,
  };
  if (server) {
    await server.sendRoomMessage(
      makeDraftRelay(msg, {
        fromPlayer: active.hostSlot,
        roomId: active.roomId,
      }),
    );
  }
  // Signal the matchmaking server that the draft is over so the room
  // transitions back to `Lobby` and (for hosted rooms) resets format
  // to `Any`. Matches the post-#82 lifecycle established for play-vs-ai
  // — the room becomes reusable for whatever the players do next.
  try {
    await useServerStore.getState().endGame();
  } catch (err) {
    console.warn("[draftHost] endGame after finishDraft failed:", err);
  }
  teardownHost();
}

/** Detach the relay listener and drop host state. Called automatically
 *  on `finishDraft`; the lobby calls it explicitly on host disconnect /
 *  leave-room so a future draft on the same client starts clean.
 *
 *  `signalEnd: true` also fires `ClientMessage::EndGame` so the
 *  matchmaking server resets the room to `Lobby` (`Any` if hosted).
 *  `finishDraft` handles its own endGame before calling teardown, so
 *  it passes `false`; mid-draft exits in `MultiplayerDraft.tsx` pass
 *  `true` to mirror that lifecycle. Server-side `EndGame` is a no-op
 *  for already-`Lobby` rooms (the connection handler logs at debug
 *  level), so duplicate signals are safe.
 *
 *  Known limitation: does not await `pendingChain`. If a peer pick is
 *  mid-`applyPick` when teardown fires (e.g. host disconnect mid-draft),
 *  the in-flight call's `if (!active) return;` guard catches it on the
 *  next async boundary but any broadcast already in motion completes
 *  with a half-shipped state. Peers observe a stale view until the
 *  session is rebuilt. Live with it for v1 — the existing multiplayer
 *  game flow has the same shape. */
export function teardownHost(signalEnd = false): void {
  if (!active) return;
  active.unsubscribe();
  active = null;
  if (signalEnd) {
    void useServerStore
      .getState()
      .endGame()
      .catch((err) => {
        console.warn("[draftHost] endGame on teardown failed:", err);
      });
  }
}
