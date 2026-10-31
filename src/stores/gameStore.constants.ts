import { notePromptArrived } from "@/lib/engineTelemetry";
import type {
  GameState,
  DeferredSnapshot,
  ClientCardDto,
  ClientGameView,
  ClientPlayerDto,
} from "./gameStore.types";
import type { EngineDirective, Prompt, ProtocolError } from "@/protocol";
import type { GameViewDto, ZoneDto, ZoneKind } from "@/protocol/game";
import { isPromptLoggingEnabled } from "@/lib/debugPrompts";
import { GAME_CARD_DEFAULTS, hiddenZoneCard } from "@/lib/gameCard";
import { flashItemOf, gameViewTransitions } from "@/lib/gameViewTransitions";
import { playSound, type SoundName } from "@/lib/soundRuntime";
import { normalizeCardCosmetics } from "@/lib/cardCosmetics";

function visibleCardsOf(zone: ZoneDto): ClientCardDto[] {
  return zone.cards.flatMap((card) =>
    card.visibility === "visible"
      ? [
          {
            ...GAME_CARD_DEFAULTS,
            ...card,
            cosmetics: card.isFaceDown ? undefined : normalizeCardCosmetics(card.cosmetics),
            zoneId: zone.zone,
          },
        ]
      : [],
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
        ? {
            ...GAME_CARD_DEFAULTS,
            ...card,
            cosmetics: card.isFaceDown ? undefined : normalizeCardCosmetics(card.cosmetics),
            zoneId: zone.zone,
          }
        : hiddenZoneCard(card.id, ownerId, zone.zone),
    );
  };

  const battlefield = zones.filter((zone) => zone.zone === "battlefield").flatMap(visibleCardsOf);

  const players: ClientPlayerDto[] = rawPlayers.map((player) => ({
    ...player,
    hand: cardsOf(player.id, "hand"),
    handCount: zoneOf(player.id, "hand")?.count ?? 0,
    graveyard: cardsOf(player.id, "graveyard"),
    exile: exileCardsOf(player.id),
    commandZone: cardsOf(player.id, "command"),
    library: cardsOf(player.id, "library"),
    libraryCount: zoneOf(player.id, "library")?.count ?? 0,
    attractionsCount: zoneOf(player.id, "attractions")?.count ?? 0,
    junkyard: cardsOf(player.id, "junkyard"),
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
    checkpoints: Array.isArray(incoming.checkpoints)
      ? incoming.checkpoints
      : (current?.checkpoints ?? []),
    snapshotRecording: incoming.snapshotRecording ?? current?.snapshotRecording ?? false,
    decisionHistory: incoming.decisionHistory ?? current?.decisionHistory,
    restoreVote: Array.isArray(incoming.checkpoints)
      ? (incoming.restoreVote ?? null)
      : (current?.restoreVote ?? null),
    activePlaneNames: Array.isArray(incoming.activePlaneNames)
      ? incoming.activePlaneNames
      : hasView
        ? undefined
        : current?.activePlaneNames,
  };
}

// A flashed transition plays its sound when its flash starts, in useFlashQueue.
export function applySnapshot(
  snapshot: DeferredSnapshot,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const sounds: SoundName[] = [];
  for (const transition of snapshot.transitions) {
    if (transition.kind !== "turnStart" && !flashItemOf(transition)) sounds.push(transition.kind);
  }
  const updates: Partial<GameState> = {};
  if (snapshot.gameView) {
    updates.gameView = snapshot.gameView;
    // An eliminated seat has no pending prompt: the engine consumed it (a
    // concede at priority) and will never await this player again.
    const me = snapshot.gameView.players.find((p) => p.id === get().myPlayerSlot);
    if (me && me.status !== "playing") updates.currentPrompt = null;
  }
  if (snapshot.prompt) {
    if (
      snapshot.prompt.input.type === "chooseAction" &&
      snapshot.prompt.promptId !== get().currentPrompt?.promptId
    ) {
      sounds.push("priority");
    }
    updates.currentPrompt = snapshot.prompt;
    updates.isWaitingForResponse = false;
    updates.relinquishedPriority = false;
  }
  set(updates);
  playSound(...sounds);
}

// Route one ordered effect: enqueue behind any pending animation, else apply now.
function route(
  snapshot: DeferredSnapshot,
  source: string,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const queueLen = get().deferredQueue.length;
  if (snapshot.transitions.some(flashItemOf) || queueLen > 0 || get().isFlashing) {
    set({
      deferredQueue: [...get().deferredQueue, snapshot],
      debugInfo: `${source} (queued #${queueLen + 1})`,
    });
    return;
  }
  applySnapshot(snapshot, (updates) => set({ ...updates, debugInfo: source }), get);
}

function latestRoutedView(get: () => GameState): ClientGameView | null {
  const queue = get().deferredQueue;
  for (let index = queue.length - 1; index >= 0; index--) {
    const view = queue[index].gameView;
    if (view) return view;
  }
  return get().gameView;
}

// The sole way game state reaches the store. Applied for every player on every
// change, regardless of whose priority it is.
export function applyState(
  gameView: GameViewDto,
  source: string,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const previousVote = get().gameView?.restoreVote;
  const vote = gameView.restoreVote;
  if (
    gameView.decisionHistory &&
    vote?.status.type === "approved" &&
    (previousVote?.voteId !== vote.voteId || previousVote?.status.type !== "approved")
  ) {
    set({
      currentPrompt: null,
      isWaitingForResponse: false,
      relinquishedPriority: false,
    });
  }
  const view = normalizeGameView(gameView, get().gameView);
  route(
    {
      transitions: gameViewTransitions(latestRoutedView(get), view, get().myPlayerSlot),
      gameView: view,
      prompt: null,
    },
    `${source}: state`,
    set,
    get,
  );
}

// The engine rejected our last response. It re-sends the open prompt right
// after the error, so recovery is just unblocking the UI for another attempt.
export function applyProtocolError(
  error: ProtocolError,
  source: string,
  set: (partial: Partial<GameState>) => void,
) {
  console.warn(`[protocol-error:${source}]`, error.code, error.promptId, error.message);
  set({ protocolError: error, isWaitingForResponse: false, relinquishedPriority: false });
}

export function applyEngineDirective(
  directive: EngineDirective,
  set: (partial: Partial<GameState>) => void,
) {
  switch (directive.type) {
    case "recording":
      set({ recording: directive.status });
      break;
    case "repeatVote":
      set({ repeatVote: directive.vote });
      break;
  }
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
  notePromptArrived(prompt.input.type);
  const normalized = prompt.sourceCard
    ? { ...prompt, sourceCard: { ...GAME_CARD_DEFAULTS, ...prompt.sourceCard } }
    : { ...prompt };
  const input = normalized.input;
  switch (input.type) {
    case "mulliganPutBack":
    case "revealCards":
    case "scry":
    case "chooseCards":
      normalized.input = {
        ...input,
        cards: input.cards.map((card) => ({ ...GAME_CARD_DEFAULTS, ...card })),
      };
      break;
    case "chooseDamageAssignmentOrder":
      normalized.input = {
        ...input,
        blockerCards: input.blockerCards.map((card) => ({ ...GAME_CARD_DEFAULTS, ...card })),
      };
      break;
    case "reorder":
      normalized.input = {
        ...input,
        items: input.items.map((item) => ({
          ...item,
          card: { ...GAME_CARD_DEFAULTS, ...item.card },
        })),
      };
      break;
  }
  route(
    { transitions: [], gameView: null, prompt: normalized },
    `${source}: ${prompt.input.type}`,
    set,
    get,
  );
}
