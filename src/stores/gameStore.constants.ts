import type {
  GameState,
  DeferredSnapshot,
  ClientCardDto,
  ClientGameView,
  ClientPlayerDto,
} from "./gameStore.types";
import type { Prompt, ProtocolError } from "@/protocol";
import type { DisplayEvent } from "@/protocol/display";
import type { GameViewDto, ZoneDto, ZoneKind } from "@/protocol/game";
import { isPromptLoggingEnabled } from "@/lib/debugPrompts";
import { hiddenZoneCard } from "@/lib/gameCard";

function visibleCardsOf(zone: ZoneDto): ClientCardDto[] {
  return zone.cards.flatMap((card) =>
    card.visibility === "visible" ? [{ ...card, zoneId: zone.zone }] : [],
  );
}

function normalizeGameView(
  nextView: GameViewDto,
  currentView: ClientGameView | null,
): ClientGameView {
  const incoming = (nextView ?? {}) as Partial<GameViewDto>;
  const current = currentView ?? null;
  const zones = Array.isArray(incoming.zones) ? incoming.zones : [];
  const rawPlayers = Array.isArray(incoming.players) ? incoming.players : [];

  const zoneOf = (ownerId: string, kind: ZoneKind) =>
    zones.find((zone) => zone.ownerId === ownerId && zone.zone === kind);
  const cardsOf = (ownerId: string, kind: ZoneKind) => {
    const zone = zoneOf(ownerId, kind);
    return zone ? visibleCardsOf(zone) : [];
  };

  // Exile keeps hidden entries (face-down foretold cards render as backs).
  const exileCardsOf = (ownerId: string) => {
    const zone = zoneOf(ownerId, "exile");
    if (!zone) return [];
    return zone.cards.map((card) =>
      card.visibility === "visible"
        ? { ...card, zoneId: zone.zone }
        : hiddenZoneCard(card.id, ownerId, zone.zone),
    );
  };

  const battlefield = zones.filter((zone) => zone.zone === "battlefield").flatMap(visibleCardsOf);

  const players: ClientPlayerDto[] = rawPlayers.map((player) => ({
    ...player,
    status: player.status ?? "playing",
    hand: cardsOf(player.id, "hand"),
    handCount: zoneOf(player.id, "hand")?.count ?? 0,
    graveyard: cardsOf(player.id, "graveyard"),
    exile: exileCardsOf(player.id),
    commandZone: cardsOf(player.id, "command"),
    library: cardsOf(player.id, "library"),
    libraryCount: zoneOf(player.id, "library")?.count ?? 0,
    poison: player.counters.poison ?? 0,
    energyCounters: player.counters.energy ?? 0,
    radiationCounters: player.counters.radiation ?? 0,
    experienceCounters: player.counters.experience ?? 0,
    ticketCounters: player.counters.ticket ?? 0,
  }));

  const hasView = zones.length > 0 || rawPlayers.length > 0;

  return {
    gameId: incoming.gameId ?? current?.gameId ?? "",
    turn: incoming.turn ?? current?.turn ?? 0,
    step: incoming.step ?? current?.step ?? "untap",
    combatAssignments: Array.isArray(incoming.combatAssignments)
      ? incoming.combatAssignments
      : (current?.combatAssignments ?? []),
    activePlayerId: incoming.activePlayerId ?? current?.activePlayerId ?? "",
    priorityPlayerId: incoming.priorityPlayerId ?? current?.priorityPlayerId ?? "",
    players: hasView ? players : (current?.players ?? []),
    zones: hasView ? zones : (current?.zones ?? []),
    battlefield: hasView ? battlefield : (current?.battlefield ?? []),
    stack: Array.isArray(incoming.stack) ? incoming.stack : (current?.stack ?? []),
    gameOver: incoming.gameOver ?? current?.gameOver ?? false,
    winnerId: incoming.winnerId ?? current?.winnerId ?? null,
    monarchId: incoming.monarchId ?? current?.monarchId ?? null,
    initiativeHolderId: incoming.initiativeHolderId ?? current?.initiativeHolderId ?? null,
    dayTime: incoming.dayTime ?? current?.dayTime ?? "neither",
  };
}

// Route one ordered effect: enqueue behind any pending animation, else apply now.
function route(
  snapshot: DeferredSnapshot,
  source: string,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const queueLen = get().deferredQueue.length;
  if (snapshot.displayEvents.length > 0 || queueLen > 0 || get().isFlashing) {
    set({
      deferredQueue: [...get().deferredQueue, snapshot],
      debugInfo: `${source} (queued #${queueLen + 1})`,
    });
    return;
  }
  const updates: Partial<GameState> = { debugInfo: source };
  if (snapshot.gameView) {
    updates.gameView = snapshot.gameView;
    // An eliminated seat has no pending prompt: the engine consumed it (a
    // concede at priority) and will never await this player again.
    const me = snapshot.gameView.players.find((p) => p.id === get().myPlayerSlot);
    if (me && me.status !== "playing") updates.currentPrompt = null;
  }
  if (snapshot.prompt) {
    updates.currentPrompt = snapshot.prompt;
    updates.isWaitingForResponse = false;
    updates.relinquishedPriority = false;
  }
  set(updates);
}

// The sole way game state reaches the store. Applied for every player on every
// change, regardless of whose priority it is.
export function applyState(
  gameView: GameViewDto,
  source: string,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  route(
    { displayEvents: [], gameView: normalizeGameView(gameView, get().gameView), prompt: null },
    `${source}: state`,
    set,
    get,
  );
}

export function applyDisplay(
  event: DisplayEvent,
  source: string,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  route({ displayEvents: [event], gameView: null, prompt: null }, `${source}: display`, set, get);
}

// The engine rejected our last response. It re-sends the open prompt right
// after the error, so recovery is just unblocking the UI for another attempt.
export function applyProtocolError(
  error: ProtocolError,
  source: string,
  set: (partial: Partial<GameState>) => void,
) {
  console.warn(`[protocol-error:${source}]`, error.code, error.promptId, error.message);
  set({ isWaitingForResponse: false, relinquishedPriority: false });
}

// A pure call-to-action: it carries no game view (state arrives via applyState).
export function applyPrompt(
  prompt: Prompt,
  source: string,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  if (isPromptLoggingEnabled()) {
    console.log(`[prompt:${source}] ${prompt.input.type}`, JSON.stringify(prompt, null, 2));
  }
  route({ displayEvents: [], gameView: null, prompt }, `${source}: ${prompt.input.type}`, set, get);
}
