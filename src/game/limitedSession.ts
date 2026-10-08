import { getPlatform } from "@/platform";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import {
  useMultiplayerLimitedStore,
  type LimitedBuild,
  type LimitedSeatStatus,
  type LimitedSeries,
  type MultiplayerLimitedState,
} from "@/stores/useMultiplayerLimitedStore";
import { BASIC_LAND_NAMES, resolveDeckCards } from "@/lib/limited.utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { ROUTES } from "@/lib/constants";
import { buildEngineGameRouteState, type EngineGameRouteState } from "@/game/engineGameLaunch";
import type { MpDraftSeatAssignment } from "@/game/draftRelay";
import type { DraftCard, SealedPool } from "@/types/limited";
import type { Deck } from "@/protocol/deck";
import type { GameStartedPayload, RoomInfo, RoomRelayEnvelope } from "@/types/server";
import { commitLimitedEngineSession, serializeLimitedSession } from "@/game/limitedPersistence";
import { captureLimitedConnection } from "@/game/limitedConnection";
import { readLimitedSave, updateLimitedSave, flushLimitedStorage } from "@/game/limitedStorage";
import type { LimitedSavedSession } from "@/game/limitedPersistence.types";
import { awaitLimitedResultAck } from "@/game/limitedResultAck";
import type { LimitedEngineCheckpoint } from "@/types/limited";

export const LIMITED_SESSION_PROTOCOL = "limited-session-v1";
interface HeldSeat {
  pool: DraftCard[];
  sealed: SealedPool | null;
  build: LimitedBuild | null;
  opened: boolean;
  ready: boolean;
  playing: boolean;
}
interface HostSession {
  sessionId: string;
  kind: "draft" | "sealed";
  room: RoomInfo;
  seats: MpDraftSeatAssignment[];
  held: Map<number, HeldSeat>;
  pairing: boolean;
  bestOf: 1 | 3;
  series: LimitedSeries[];
  recordedGames: Set<string>;
  relayGameId: string;
  acceptedRequests: Set<string>;
}
type SessionPayload =
  | { type: "register"; sessionId: string }
  | { type: "resync"; sessionId?: string }
  | {
      type: "snapshot";
      sessionId: string;
      kind: "draft" | "sealed";
      room: RoomInfo;
      seats: MpDraftSeatAssignment[];
      seat: number;
      pool: DraftCard[];
      sealed: SealedPool | null;
      build: LimitedBuild | null;
      statuses: LimitedSeatStatus[];
      bestOf: 1 | 3;
      series: LimitedSeries[];
    }
  | {
      type: "statuses";
      sessionId: string;
      statuses: LimitedSeatStatus[];
      bestOf: 1 | 3;
      series: LimitedSeries[];
    }
  | { type: "build"; sessionId: string; build: LimitedBuild; ready: boolean }
  | { type: "opened"; sessionId: string }
  | { type: "rejected"; sessionId: string; message: string }
  | {
      type: "pairMatches";
      sessionId: string;
      pairs: Array<{ players: Array<{ username: string; deck: Deck }> }>;
    }
  | { type: "matchAssigned"; sessionId: string; room: RoomInfo }
  | { type: "returnToSession"; sessionId: string }
  | { type: "result"; sessionId: string; gameId: string; winner: string | null }
  | { type: "resultAck"; sessionId: string; gameId: string }
  | { type: "seatReturned"; sessionId: string; username: string }
  | { type: "returned"; sessionId: string; room: RoomInfo };
let host: HostSession | null = null;
let offSession: (() => void) | null = null;
let returnJob: Promise<string | null> | null = null;

async function send(payload: SessionPayload, roomId: string, targetPlayer?: string) {
  const server = getPlatform().server;
  if (!server || !useServerStore.getState().connected)
    throw new Error("Multiplayer server is disconnected.");
  await server.sendRoomMessage({
    kind: "roomRelay",
    protocol: LIMITED_SESSION_PROTOCOL,
    version: 1,
    messageId: crypto.randomUUID(),
    roomId,
    fromPlayer: useServerStore.getState().username ?? undefined,
    targetPlayer,
    payload,
  });
}
function statuses(session: HostSession): LimitedSeatStatus[] {
  return session.seats.map((s) => ({
    seat: s.seat,
    ready: session.held.get(s.seat)?.ready ?? false,
    opened: session.held.get(s.seat)?.opened ?? false,
    playing: session.held.get(s.seat)?.playing ?? false,
  }));
}
export async function validateLimitedBuild(
  pool: DraftCard[],
  build: LimitedBuild,
  ready: boolean,
): Promise<string | null> {
  if (!Array.isArray(build?.main) || !Array.isArray(build?.sideboard))
    return "Invalid deck sections.";
  if (ready && build.main.length < 40) return "Main deck needs at least 40 cards.";
  const acquired = new Map(pool.map((c) => [c.id, c]));
  const seen = new Set<string>();
  for (const card of [...build.main, ...build.sideboard]) {
    if (!card || typeof card.id !== "string" || !card.id || seen.has(card.id))
      return "Each card occurrence can appear only once.";
    seen.add(card.id);
    const owned = acquired.get(card.id);
    if (owned) {
      if (
        card.name !== owned.name ||
        card.setCode !== owned.setCode ||
        card.cardNumber !== owned.cardNumber ||
        Boolean(card.foil) !== Boolean(owned.foil)
      )
        return "A card's printing or finish was changed.";
    } else {
      if (
        !BASIC_LAND_NAMES.some((name) => name === card.name) ||
        card.foil ||
        !card.setCode ||
        !card.cardNumber
      )
        return "The deck contains a card outside your pool.";
      const printing = await useScryfallStore
        .getState()
        .getCard({ name: card.name, setCode: card.setCode, cardNumber: card.cardNumber });
      if (
        !printing ||
        printing.info.name !== card.name ||
        printing.info.set.toLowerCase() !== card.setCode.toLowerCase() ||
        printing.info.collector_number !== card.cardNumber ||
        !printing.info.type_line.includes("Basic Land")
      )
        return "Added lands must be verified basic-land printings.";
    }
  }
  if (pool.some((card) => !seen.has(card.id)))
    return "Every acquired card must remain in Main or Sideboard.";
  return null;
}
export async function registerLimitedSession(args: {
  kind: "draft" | "sealed";
  sessionId: string;
  room: RoomInfo;
  seats: MpDraftSeatAssignment[];
  pools: Array<{
    seat: number;
    pool: DraftCard[];
    sealed?: SealedPool | null;
    build?: LimitedBuild | null;
  }>;
}) {
  if (args.room.host !== useServerStore.getState().username)
    throw new Error("Only the room host can create pools.");
  if (!useServerStore.getState().hasRelayFeature("limited_session_recovery"))
    throw new Error("Update the relay to use durable multiplayer Limited sessions.");
  attachLimitedSessionPeer();
  host = {
    sessionId: args.sessionId,
    kind: args.kind,
    room: args.room,
    seats: args.seats,
    held: new Map(
      args.pools.map((p) => [
        p.seat,
        {
          pool: p.pool,
          sealed: p.sealed ?? null,
          build: p.build ?? null,
          opened: args.kind === "draft" || !args.seats.find((s) => s.seat === p.seat)?.isHuman,
          ready: !args.seats.find((s) => s.seat === p.seat)?.isHuman && Boolean(p.build),
          playing: false,
        },
      ]),
    ),
    pairing: false,
    bestOf: 3,
    series: [],
    recordedGames: new Set(),
    relayGameId: useServerStore.getState().gameId || args.sessionId,
    acceptedRequests: new Set(),
  };
  await persistHostSession(host);
  await send({ type: "register", sessionId: args.sessionId }, args.room.room_id);
  await Promise.all(args.seats.filter((s) => s.playerSlot).map((s) => deliverSnapshot(host!, s)));
}
async function acceptSnapshot(msg: Extract<SessionPayload, { type: "snapshot" }>) {
  await saveLocalLimitedState({
    kind: msg.kind,
    sessionId: msg.sessionId,
    originalRoom: msg.room,
    seats: msg.seats,
    mySeat: msg.seat,
    pool: msg.pool,
    sealed: msg.sealed,
    build: msg.build,
    statuses: msg.statuses,
    bestOf: msg.bestOf,
    series: msg.series,
    phase:
      msg.kind === "sealed" && !msg.statuses.find((status) => status.seat === msg.seat)?.opened
        ? "opening"
        : "building",
  });
  useMultiplayerLimitedStore.getState().enter({
    kind: msg.kind,
    sessionId: msg.sessionId,
    originalRoom: msg.room,
    seats: msg.seats,
    mySeat: msg.seat,
    pool: msg.pool,
    sealed: msg.sealed,
    build: msg.build,
    statuses: msg.statuses,
    bestOf: msg.bestOf,
    series: msg.series,
  });
  if (msg.kind === "draft") {
    useMultiplayerDraftStore.getState().complete();
  } else if (msg.sealed) {
    useMultiplayerSealedStore.getState().enter({
      roomId: msg.room.room_id,
      setCode: msg.sealed.deckName,
      pool: msg.pool,
      sessionId: msg.sessionId,
    });
  }
}
async function deliverSnapshot(session: HostSession, seat: MpDraftSeatAssignment) {
  const held = session.held.get(seat.seat);
  if (!held || !seat.playerSlot) return;
  const msg: Extract<SessionPayload, { type: "snapshot" }> = {
    type: "snapshot",
    sessionId: session.sessionId,
    kind: session.kind,
    room: session.room,
    seats: session.seats,
    seat: seat.seat,
    pool: held.pool,
    sealed: held.sealed,
    build: held.build,
    statuses: statuses(session),
    bestOf: session.bestOf,
    series: session.series,
  };
  if (seat.playerSlot === useServerStore.getState().username) await acceptSnapshot(msg);
  else await send(msg, session.room.room_id, seat.playerSlot);
}
async function publishStatuses(session: HostSession) {
  await persistHostSession(session);
  const current = statuses(session);
  useMultiplayerLimitedStore.setState({
    statuses: current,
    bestOf: session.bestOf,
    series: session.series,
  });
  await send(
    {
      type: "statuses",
      sessionId: session.sessionId,
      statuses: current,
      bestOf: session.bestOf,
      series: session.series,
    },
    session.room.room_id,
  );
}
async function applyBuild(
  session: HostSession,
  seat: MpDraftSeatAssignment,
  build: LimitedBuild,
  ready: boolean,
) {
  const held = session.held.get(seat.seat);
  if (!held || held.playing) return;
  held.ready = false;
  let error: string | null;
  try {
    error = await validateLimitedBuild(held.pool, build, ready);
  } catch {
    error = "A basic land printing could not be verified. Reconnect and ready your deck again.";
  }
  if (error || (ready && !held.opened)) {
    held.ready = false;
    await persistHostSession(session);
    const message = error ?? "Open your packs before readying your deck.";
    if (seat.playerSlot === useServerStore.getState().username)
      useMultiplayerLimitedStore.getState().setError(message);
    else if (seat.playerSlot)
      await send(
        { type: "rejected", sessionId: session.sessionId, message },
        session.room.room_id,
        seat.playerSlot,
      );
  } else {
    held.build = build;
    held.ready = ready;
  }
  await publishStatuses(session);
}
export function attachLimitedSessionPeer(): () => void {
  if (offSession) return offSession;
  offSession = getPlatform().events.on<{
    from_player: string;
    state: RoomRelayEnvelope<SessionPayload>;
  }>("server:room_message", async (event) => {
    const env = event.state;
    if (
      env.protocol !== LIMITED_SESSION_PROTOCOL ||
      env.version !== 1 ||
      env.fromPlayer !== event.from_player ||
      !env.roomId
    )
      return;
    const server = useServerStore.getState();
    const local = useMultiplayerLimitedStore.getState();
    const room =
      local.originalRoom?.room_id === env.roomId ? local.originalRoom : server.currentRoom;
    if (!room || room.room_id !== env.roomId) return;
    if (env.targetPlayer && env.targetPlayer !== server.username) return;
    const msg = env.payload;
    if (!msg || typeof msg !== "object") return;
    if (
      msg.type === "resync" ||
      msg.type === "build" ||
      msg.type === "opened" ||
      msg.type === "result"
    ) {
      const session = host;
      if (
        !session ||
        session.room.room_id !== env.roomId ||
        (msg.sessionId && msg.sessionId !== session.sessionId) ||
        env.targetPlayer !== room.host
      )
        return;
      const seat = session.seats.find((s) => s.playerSlot === event.from_player && s.isHuman);
      if (!seat) return;
      void enqueueLimitedHost(async () => {
        if (host !== session) return;
        if (msg.type !== "resync" && session.acceptedRequests.has(env.messageId)) {
          if (msg.type === "result" && session.recordedGames.has(msg.gameId) && seat.playerSlot)
            await send(
              { type: "resultAck", sessionId: session.sessionId, gameId: msg.gameId },
              session.room.room_id,
              seat.playerSlot,
            );
          else await deliverSnapshot(session, seat);
          return;
        }
        if (msg.type !== "resync") session.acceptedRequests.add(env.messageId);
        if (msg.type === "resync") await deliverSnapshot(session, seat);
        else if (msg.type === "build")
          await applyBuild(session, seat, msg.build, msg.ready === true);
        else if (msg.type === "result") {
          const series = session.series.find((match) => match.seats[0] === seat.seat);
          if (!series) return;
          if (session.recordedGames.has(msg.gameId)) {
            await send(
              { type: "resultAck", sessionId: session.sessionId, gameId: msg.gameId },
              session.room.room_id,
              seat.playerSlot!,
            );
            return;
          }
          session.recordedGames.add(msg.gameId);
          const winner = series.seats.findIndex((id) => {
            const s = session.seats.find((candidate) => candidate.seat === id)!;
            return (s.playerSlot ?? `limited-ai-${session.sessionId}-${s.seat}`) === msg.winner;
          });
          if (winner >= 0) series.wins[winner] += 1;
          series.complete = series.wins.some((wins) => wins >= (session.bestOf === 3 ? 2 : 1));
          for (const id of series.seats) session.held.get(id)!.ready = false;
          await publishStatuses(session);
          await send(
            { type: "resultAck", sessionId: session.sessionId, gameId: msg.gameId },
            session.room.room_id,
            seat.playerSlot!,
          );
        } else {
          const held = session.held.get(seat.seat);
          if (held) held.opened = true;
          await publishStatuses(session);
        }
      }).catch((error) => useMultiplayerLimitedStore.getState().setError(String(error)));
      return;
    }
    if (event.from_player !== room.host) return;
    void enqueueLimitedHost(async () => {
      const local = useMultiplayerLimitedStore.getState();
      const server = useServerStore.getState();
      if (env.targetPlayer && env.targetPlayer !== server.username) return;
      if (
        msg.type === "rejected" &&
        msg.sessionId === useMultiplayerDraftStore.getState().sessionId &&
        local.phase === "idle"
      ) {
        useMultiplayerDraftStore.getState().setError(msg.message);
        return;
      }
      if (msg.type === "snapshot") {
        if (
          env.targetPlayer !== server.username ||
          msg.room.room_id !== env.roomId ||
          msg.seats.find((s) => s.seat === msg.seat)?.playerSlot !== server.username
        )
          return;
        if (local.sessionId && local.sessionId !== msg.sessionId && local.phase !== "idle") return;
        await acceptSnapshot(msg);
      } else if (msg.sessionId !== local.sessionId) return;
      else if (msg.type === "statuses") {
        await saveLocalLimitedState({
          statuses: msg.statuses,
          bestOf: msg.bestOf,
          series: msg.series,
        });
        useMultiplayerLimitedStore.setState({
          statuses: msg.statuses,
          bestOf: msg.bestOf,
          series: msg.series,
        });
      } else if (msg.type === "rejected") {
        local.setError(msg.message);
        if (host && !local.matchReturn) {
          host.pairing = false;
          for (const held of host.held.values()) held.playing = false;
          await publishStatuses(host);
        }
      } else if (msg.type === "seatReturned" && host && env.targetPlayer === server.username) {
        const seat = host.seats.find((s) => s.playerSlot === msg.username);
        const held = seat && host.held.get(seat.seat);
        if (held) {
          held.playing = false;
          held.ready = false;
        }
        for (const bot of host.seats.filter((s) => !s.isHuman)) {
          const heldBot = host.held.get(bot.seat)!;
          heldBot.playing = false;
          heldBot.ready = true;
        }
        host.pairing = host.seats.some((s) => s.isHuman && host!.held.get(s.seat)?.playing);
        await publishStatuses(host);
      } else if (
        msg.type === "matchAssigned" &&
        env.targetPlayer === server.username &&
        msg.room.players.some((p) => p.username === server.username)
      ) {
        await saveLocalLimitedState({
          phase: "playing",
          matchReturn: {
            roomId: msg.room.room_id,
            host: msg.room.host,
            route:
              local.kind === "draft"
                ? `${ROUTES.DRAFT}/multiplayer`
                : `${ROUTES.SEALED}/multiplayer`,
            sessionId: msg.sessionId,
          },
        });
        useMultiplayerLimitedStore.setState({
          phase: "playing",
          matchReturn: {
            roomId: msg.room.room_id,
            host: msg.room.host,
            route:
              local.kind === "draft"
                ? `${ROUTES.DRAFT}/multiplayer`
                : `${ROUTES.SEALED}/multiplayer`,
            sessionId: msg.sessionId,
          },
        });
        useServerStore.setState({ currentRoom: msg.room, gameStarted: false });
        if (msg.room.host === server.username) void getPlatform().server?.startGame();
        else await getPlatform().server?.requestResync();
      } else if (msg.type === "returned" && env.targetPlayer === server.username) {
        await saveLocalLimitedState({ phase: "building", matchReturn: null });
        useServerStore.setState({ currentRoom: msg.room, gameStarted: false });
        useMultiplayerLimitedStore.setState({ phase: "building", matchReturn: null });
        void requestLimitedResync();
      }
    }, msg.sessionId).catch((error) =>
      useMultiplayerLimitedStore.getState().setError(String(error)),
    );
  });
  return offSession;
}
export async function requestLimitedResync() {
  const local = useMultiplayerLimitedStore.getState();
  const room = local.originalRoom ?? useServerStore.getState().currentRoom;
  if (!room || (!room.draft_config && !room.sealed_config)) return;
  if (room.host === useServerStore.getState().username) {
    if (!host && local.sessionId) {
      const saved = await readLimitedSave(local.sessionId);
      if (saved?.hostSession) await restoreLimitedHostSession(saved);
      else local.setError("No saved host session exists. Your saved build is still available.");
    }
    if (host) {
      const own = host.seats.find((seat) => seat.playerSlot === room.host);
      if (own) await deliverSnapshot(host, own);
    }
    return;
  }
  await send({ type: "resync", sessionId: local.sessionId ?? undefined }, room.room_id, room.host);
}
async function submitLimitedBuildNow(main: DraftCard[], sideboard: DraftCard[], ready = false) {
  const local = useMultiplayerLimitedStore.getState();
  if (!local.sessionId || !local.originalRoom || local.phase !== "building") return;
  const build = { main, sideboard };
  await saveLocalLimitedState({ build });
  local.setBuild(build);
  local.setError(null);
  if (host?.sessionId === local.sessionId) {
    const session = host;
    const seat = session.seats.find((s) => s.seat === local.mySeat);
    if (seat) {
      session.held.get(seat.seat)!.ready = false;
      await applyBuild(session, seat, build, ready);
    }
  } else
    await send(
      { type: "build", sessionId: local.sessionId, build, ready },
      local.originalRoom.room_id,
      local.originalRoom.host,
    );
}
async function completeLimitedOpeningNow() {
  const local = useMultiplayerLimitedStore.getState();
  if (!local.sessionId || !local.originalRoom) return;
  await saveLocalLimitedState({ phase: "building" });
  local.opened();
  if (host?.sessionId === local.sessionId) {
    const held = host.held.get(local.mySeat!);
    if (held) held.opened = true;
    await publishStatuses(host);
  } else
    await send(
      { type: "opened", sessionId: local.sessionId },
      local.originalRoom.room_id,
      local.originalRoom.host,
    );
}
async function setLimitedBestOfNow(bestOf: 1 | 3) {
  if (
    !host ||
    host.pairing ||
    host.series.some((match) => !match.complete && match.wins.some((wins) => wins > 0))
  )
    return;
  host.bestOf = bestOf;
  if (host.series.every((match) => match.complete)) host.series = [];
  await publishStatuses(host);
}
async function startLimitedMatchesNow() {
  const session = host;
  if (!session || session.pairing) return;
  if (host !== session || session.pairing) return;
  if (!useServerStore.getState().hasRelayFeature("limited_sessions"))
    throw new Error("This relay needs an update before Limited decks can play.");
  const unfinished = session.series
    .filter((match) => !match.complete)
    .flatMap((match) => match.seats);
  if (
    session.seats.some(
      (s) =>
        session.held.get(s.seat)?.playing ||
        ((unfinished.length === 0 || unfinished.includes(s.seat)) &&
          !session.held.get(s.seat)?.ready),
    )
  )
    throw new Error("Every active seat must return and ready a valid deck first.");
  if (session.series.length === 0 || session.series.every((match) => match.complete)) {
    const humans = session.seats.filter((s) => s.isHuman && s.playerSlot);
    const bots = session.seats.filter((s) => !s.isHuman);
    session.series = [];
    for (let index = 0; index < humans.length; index += 2) {
      const second = humans[index + 1] ?? bots.shift();
      if (!second) throw new Error("An odd human pod needs an AI seat for casual pairing.");
      session.series.push({
        seats: [humans[index].seat, second.seat],
        wins: [0, 0],
        complete: false,
      });
    }
  }
  for (const match of session.series.filter((m) => !m.complete))
    for (const id of match.seats) session.held.get(id)!.playing = true;
  session.pairing = true;
  try {
    const pairs = await Promise.all(
      session.series
        .filter((match) => !match.complete)
        .map(async (match) => ({
          players: await Promise.all(
            match.seats.map(async (id) => {
              const s = session.seats.find((seat) => seat.seat === id)!;
              const build = session.held.get(id)!.build!;
              return {
                username: s.playerSlot ?? `limited-ai-${session.sessionId}-${s.seat}`,
                deck: {
                  name: `${s.displayName} Limited`,
                  format: session.kind,
                  cards: await resolveDeckCards(build.main),
                  sideboard: await resolveDeckCards(build.sideboard),
                  draft: true,
                } satisfies Deck,
              };
            }),
          ),
        })),
    );
    await publishStatuses(session);
    await send({ type: "pairMatches", sessionId: session.sessionId, pairs }, session.room.room_id);
  } catch (error) {
    session.pairing = false;
    for (const held of session.held.values()) held.playing = false;
    useMultiplayerLimitedStore.setState({ statuses: statuses(session) });
    throw error;
  }
}
export function limitedGameLaunch(payload: GameStartedPayload): EngineGameRouteState | null {
  const local = useMultiplayerLimitedStore.getState();
  if (!local.matchReturn || payload.room_id !== local.matchReturn.roomId) return null;
  const server = useServerStore.getState();
  const result = buildEngineGameRouteState(
    server.username,
    server.currentRoom,
    payload.player_order,
    payload.player_decks,
    payload.starting_life,
  );
  if (result.error) {
    local.setError(result.error);
    return null;
  }
  useServerStore.setState({ gameStarted: false });
  return result.state ?? null;
}
export function peekLimitedMatchReturn() {
  return useMultiplayerLimitedStore.getState().matchReturn;
}
export function completeLimitedMatch(): Promise<string | null> {
  returnJob ??= returnLimitedMatch().finally(() => {
    returnJob = null;
  });
  return returnJob;
}
async function returnLimitedMatch(recordResult = true): Promise<string | null> {
  const local = useMultiplayerLimitedStore.getState();
  const pendingReturn = local.matchReturn;
  if (!pendingReturn || !local.originalRoom) return null;
  let marker = pendingReturn;
  const game = useGameStore.getState();
  const server = useServerStore.getState();
  if (recordResult && marker.host === server.username && !marker.result) {
    const winnerIndex =
      game.gameView?.gameOver && game.gameView.winnerId
        ? Number(game.gameView.winnerId.replace("player-", ""))
        : -1;
    marker = {
      ...marker,
      result: { gameId: server.gameId, winner: server.playerOrder[winnerIndex] ?? null },
    };
    await saveLocalLimitedState({ matchReturn: { ...marker } });
    useMultiplayerLimitedStore.setState({ matchReturn: { ...marker } });
  }
  if (
    marker.result &&
    !marker.resultAcknowledged &&
    (recordResult || server.currentRoom?.room_id === marker.roomId)
  ) {
    if (!server.username)
      throw new Error("Reconnect your saved seat before submitting this result.");
    await awaitLimitedResultAck({
      sessionId: marker.sessionId,
      gameId: marker.result.gameId,
      roomId: local.originalRoom.room_id,
      host: local.originalRoom.host,
      username: server.username,
      send: () =>
        send(
          { type: "result", sessionId: marker.sessionId, ...marker.result! },
          local.originalRoom!.room_id,
          local.originalRoom!.host,
        ),
    });
    marker = { ...marker, resultAcknowledged: true };
    await saveLocalLimitedState({ matchReturn: marker });
    useMultiplayerLimitedStore.setState({ matchReturn: marker });
  }
  if (game.isGameActive) await game.endGame();
  if (
    marker.host === server.username &&
    server.currentRoom?.room_id === marker.roomId &&
    server.currentRoom.status === "InGame"
  )
    await server.endGame();
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  const timeout = setTimeout(() => {
    off();
    reject(new Error("The relay did not confirm your return. Reconnect and retry."));
  }, 7000);
  const off = getPlatform().events.on<{
    from_player: string;
    state: RoomRelayEnvelope<SessionPayload>;
  }>("server:room_message", (event) => {
    if (
      event.from_player !== local.originalRoom!.host ||
      event.state.fromPlayer !== event.from_player ||
      event.state.protocol !== LIMITED_SESSION_PROTOCOL ||
      event.state.roomId !== local.originalRoom!.room_id ||
      event.state.targetPlayer !== server.username ||
      event.state.payload.type !== "returned" ||
      event.state.payload.sessionId !== marker.sessionId
    )
      return;
    clearTimeout(timeout);
    off();
    const room = event.state.payload.room;
    void saveLocalLimitedState({ phase: "building", matchReturn: null })
      .then(() => {
        useServerStore.setState({ currentRoom: room, gameStarted: false });
        useMultiplayerLimitedStore.setState({ phase: "building", matchReturn: null });
        resolve();
      })
      .catch(reject);
  });
  try {
    await send(
      { type: "returnToSession", sessionId: marker.sessionId },
      local.originalRoom.room_id,
      local.originalRoom.host,
    );
    await promise;
  } finally {
    clearTimeout(timeout);
    off();
  }
  return marker.route;
}
export function clearLimitedSession() {
  if (host?.kind === "sealed")
    for (const held of host.held.values()) {
      if (held.sealed)
        void getPlatform()
          .invoke("limited_drop_session", { kind: "sealed", sessionId: held.sealed.sessionId })
          .catch((error) => console.warn("Could not release the Sealed engine pool:", error));
    }
  host = null;
  offSession?.();
  offSession = null;
  useMultiplayerLimitedStore.getState().clear();
  useMultiplayerSealedStore.getState().clear();
}

async function persistHostSession(session: HostSession): Promise<void> {
  const ownSeat = session.seats.find((seat) => seat.playerSlot === session.room.host);
  const own = ownSeat && session.held.get(ownSeat.seat);
  if (!own || !ownSeat) throw new Error("The Limited host seat is unavailable.");
  const sealedCheckpoints =
    session.kind === "sealed"
      ? await Promise.all(
          [...session.held.values()]
            .filter((held) => held.sealed)
            .map((held) =>
              getPlatform().invoke<LimitedEngineCheckpoint>("limited_export_session", {
                kind: "sealed",
                sessionId: held.sealed!.sessionId,
              }),
            ),
        )
      : undefined;
  const hostSession = {
    ...session,
    held: [...session.held.entries()],
    recordedGames: [...session.recordedGames],
    acceptedRequests: [...session.acceptedRequests],
  };
  const metadata: Partial<LimitedSavedSession> = {
    role: "host",
    seat: ownSeat.seat,
    hostSession,
    sealedCheckpoints,
    connection: captureLimitedConnection(session.room, session.sessionId, session.relayGameId),
  };
  if (session.kind === "sealed" && own.sealed)
    await commitLimitedEngineSession("sealed", session.sessionId, own.sealed, metadata);
  else
    await updateLimitedSave(session.sessionId, (saved) => {
      if (!saved) throw new Error("The draft checkpoint is missing.");
      return { ...saved, ...metadata, updatedAt: Date.now() };
    });
}

export async function restoreLimitedHostSession(saved: LimitedSavedSession): Promise<void> {
  const snapshot = saved.hostSession as
    | (Omit<HostSession, "held" | "recordedGames" | "acceptedRequests"> & {
        held: Array<[number, HeldSeat]>;
        recordedGames: string[];
        acceptedRequests: string[];
      })
    | undefined;
  if (!snapshot || snapshot.room.host !== useServerStore.getState().username)
    throw new Error("Only the original host can restore this Limited session.");
  for (const checkpoint of saved.sealedCheckpoints ?? [])
    await getPlatform().invoke("limited_import_session", { checkpoint });
  host = {
    ...snapshot,
    held: new Map(snapshot.held),
    recordedGames: new Set(snapshot.recordedGames),
    acceptedRequests: new Set(snapshot.acceptedRequests ?? []),
  };
  attachLimitedSessionPeer();
  const own = host.seats.find((seat) => seat.playerSlot === host!.room.host);
  if (own) await deliverSnapshot(host, own);
}

async function saveLocalLimitedState(change: Partial<MultiplayerLimitedState>): Promise<void> {
  const local = { ...useMultiplayerLimitedStore.getState(), ...change };
  if (!local.sessionId || !local.kind || !local.originalRoom || local.mySeat === null) return;
  await flushLimitedStorage();
  const peerSession = JSON.parse(JSON.stringify(local));
  await updateLimitedSave(local.sessionId, (previous) => ({
    schemaVersion: 1,
    title: local.kind === "draft" ? "Booster Draft" : "Sealed",
    createdAt: Date.now(),
    archived: false,
    checkpoint: null,
    history: [],
    ...previous,
    sessionId: local.sessionId!,
    kind: local.kind!,
    seat: local.mySeat!,
    role: local.originalRoom!.host === useServerStore.getState().username ? "host" : "peer",
    complete: true,
    state: local.sealed ?? previous?.state ?? null,
    peerSession,
    connection: captureLimitedConnection(
      local.originalRoom!,
      local.sessionId!,
      previous?.connection?.resume.game_id,
    ),
    updatedAt: Date.now(),
  }));
}

function enqueueLimitedHost<T>(operation: () => Promise<T>, sessionId?: string): Promise<T> {
  const id =
    sessionId ??
    host?.sessionId ??
    useMultiplayerLimitedStore.getState().sessionId ??
    useMultiplayerDraftStore.getState().sessionId ??
    "limited";
  return serializeLimitedSession(id, async () => {
    try {
      return await operation();
    } catch (error) {
      const saved = await readLimitedSave(id).catch(() => null);
      if (saved?.hostSession) {
        const snapshot = saved.hostSession as Omit<
          HostSession,
          "held" | "recordedGames" | "acceptedRequests"
        > & {
          held: Array<[number, HeldSeat]>;
          recordedGames: string[];
          acceptedRequests: string[];
        };
        host = {
          ...snapshot,
          held: new Map(snapshot.held),
          recordedGames: new Set(snapshot.recordedGames),
          acceptedRequests: new Set(snapshot.acceptedRequests ?? []),
        };
      } else if (host?.sessionId === id) host = null;
      throw error;
    }
  });
}

export async function submitLimitedBuild(
  main: DraftCard[],
  sideboard: DraftCard[],
  ready = false,
): Promise<void> {
  await enqueueLimitedHost(() => submitLimitedBuildNow(main, sideboard, ready));
}

export async function completeLimitedOpening(): Promise<void> {
  await enqueueLimitedHost(completeLimitedOpeningNow);
}

export async function setLimitedBestOf(bestOf: 1 | 3): Promise<void> {
  await enqueueLimitedHost(() => setLimitedBestOfNow(bestOf));
}

export async function startLimitedMatches(): Promise<void> {
  await enqueueLimitedHost(startLimitedMatchesNow);
}

export async function republishLimitedHostSession(): Promise<void> {
  if (!host) return;
  await send({ type: "register", sessionId: host.sessionId }, host.room.room_id);
  await Promise.all(
    host.seats.filter((seat) => seat.playerSlot).map((seat) => deliverSnapshot(host!, seat)),
  );
}

export function recoverLimitedMatchReturn(): Promise<string | null> {
  returnJob ??= returnLimitedMatch(false).finally(() => {
    returnJob = null;
  });
  return returnJob;
}
