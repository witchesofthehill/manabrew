import type { GameState, DeferredSnapshot } from "./gameStore.types";
import type { Prompt } from "@/protocol";
import type { GameView } from "@/types/manabrew";

function normalizeGameView(nextView: GameView, currentView: GameView | null): GameView {
  const incoming = (nextView ?? {}) as Partial<GameView>;
  const current = currentView ?? null;

  return {
    gameId: incoming.gameId ?? current?.gameId ?? "",
    turn: incoming.turn ?? current?.turn ?? 0,
    step: incoming.step ?? current?.step ?? "",
    combatAssignments: Array.isArray(incoming.combatAssignments)
      ? incoming.combatAssignments
      : (current?.combatAssignments ?? []),
    activePlayerId: incoming.activePlayerId ?? current?.activePlayerId ?? "",
    priorityPlayerId: incoming.priorityPlayerId ?? current?.priorityPlayerId ?? "",
    players: Array.isArray(incoming.players) ? incoming.players : (current?.players ?? []),
    myHand: Array.isArray(incoming.myHand) ? incoming.myHand : (current?.myHand ?? []),
    battlefield: Array.isArray(incoming.battlefield)
      ? incoming.battlefield
      : (current?.battlefield ?? []),
    stack: Array.isArray(incoming.stack) ? incoming.stack : (current?.stack ?? []),
    exile: Array.isArray(incoming.exile) ? incoming.exile : (current?.exile ?? []),
    graveyard: Array.isArray(incoming.graveyard) ? incoming.graveyard : (current?.graveyard ?? []),
    myCommandZone: Array.isArray(incoming.myCommandZone)
      ? incoming.myCommandZone
      : (current?.myCommandZone ?? []),
    opponentZones:
      incoming.opponentZones && typeof incoming.opponentZones === "object"
        ? incoming.opponentZones
        : (current?.opponentZones ?? {}),
    gameOver: incoming.gameOver ?? current?.gameOver,
    winnerId: incoming.winnerId ?? current?.winnerId ?? null,
    monarchId: incoming.monarchId ?? current?.monarchId ?? null,
    initiativeHolderId: incoming.initiativeHolderId ?? current?.initiativeHolderId ?? null,
  };
}

export function applyPrompt(
  prompt: Prompt,
  source: string,
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const displayEvents = [...(prompt.displayEvents ?? [])];
  // Don't mutate the original payload (listeners may fire more than once).
  const input = prompt.input;

  const currentGameView = get().gameView;
  const normalizedGameView = normalizeGameView(input.gameView, currentGameView);
  const queueLen = get().deferredQueue.length;
  // stateUpdate prompts only carry a gameView + display events — they should
  // NOT replace the currentPrompt (the active player decision).
  const isStateUpdate = input.type === "stateUpdate";
  const myPlayerSlot = get().myPlayerSlot;
  const isForeignPrompt =
    !isStateUpdate &&
    prompt.decidingPlayerId != null &&
    myPlayerSlot != null &&
    prompt.decidingPlayerId !== myPlayerSlot;

  if (displayEvents.length > 0 && currentGameView !== null) {
    // Enqueue this snapshot — the flash processor will play the events then apply the state.
    const snapshot: DeferredSnapshot = {
      displayEvents,
      gameView: normalizedGameView,
      prompt: isStateUpdate || isForeignPrompt ? null : prompt,
    };
    set({
      deferredQueue: [...get().deferredQueue, snapshot],
      debugInfo: `${source}: ${input.type} (queued #${queueLen + 1})`,
    });
  } else if (queueLen > 0 || get().isFlashing) {
    // Flashes are in progress but this prompt has no display events — enqueue with empty events
    // so it gets applied after the current flash sequence finishes.
    const snapshot: DeferredSnapshot = {
      displayEvents: [],
      gameView: normalizedGameView,
      prompt: isStateUpdate || isForeignPrompt ? null : prompt,
    };
    set({
      deferredQueue: [...get().deferredQueue, snapshot],
      debugInfo: `${source}: ${input.type} (queued-passthrough #${queueLen + 1})`,
    });
  } else {
    // No display events and no queue — apply immediately
    const updates: Partial<GameState> = {
      gameView: normalizedGameView,
      debugInfo: `${source}: ${input.type}`,
      isWaitingForResponse: false,
      currentPrompt: isStateUpdate || isForeignPrompt ? null : prompt,
    };
    set(updates);
  }
}
