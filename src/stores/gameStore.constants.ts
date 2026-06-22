import type { GameState, DeferredSnapshot } from "./gameStore.types";
import type { Prompt } from "@/protocol";
import type { DisplayEvent } from "@/protocol/display";
import type { GameViewDto } from "@/protocol/game";
import { isPromptLoggingEnabled } from "@/lib/debugPrompts";

function normalizeGameView(nextView: GameViewDto, currentView: GameViewDto | null): GameViewDto {
  const incoming = (nextView ?? {}) as Partial<GameViewDto>;
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
    battlefield: Array.isArray(incoming.battlefield)
      ? incoming.battlefield
      : (current?.battlefield ?? []),
    stack: Array.isArray(incoming.stack) ? incoming.stack : (current?.stack ?? []),
    gameOver: incoming.gameOver ?? current?.gameOver ?? false,
    winnerId: incoming.winnerId ?? current?.winnerId ?? null,
    concededPlayerIds: Array.isArray(incoming.concededPlayerIds)
      ? incoming.concededPlayerIds
      : (current?.concededPlayerIds ?? []),
    monarchId: incoming.monarchId ?? current?.monarchId ?? null,
    initiativeHolderId: incoming.initiativeHolderId ?? current?.initiativeHolderId ?? null,
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
  if (snapshot.gameView) updates.gameView = snapshot.gameView;
  if (snapshot.prompt) {
    updates.currentPrompt = snapshot.prompt;
    updates.isWaitingForResponse = false;
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
