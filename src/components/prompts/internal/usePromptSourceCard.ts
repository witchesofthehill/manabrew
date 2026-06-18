import { useMemo } from "react";

import { asDeckCard } from "@/lib/decks";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { useGameStore } from "@/stores/useGameStore";
import type { DeckCard, GameCard } from "@/types/manabrew";

export function useResolveDeckCard(cardId: string | undefined): DeckCard | undefined {
  const gameView = useGameStore((s) => s.gameView);
  const gameDecks = useGameStore((s) => s.gameDecks);

  return useMemo(() => {
    if (!cardId || !gameView) return undefined;
    const visible: GameCard[] = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
    ];
    let gc = visible.find((c) => c.id === cardId);
    if (!gc) {
      const stackObj = gameView.stack.find((s) => s.sourceId === cardId);
      if (stackObj) gc = stackObjectToCardStub(stackObj);
    }
    if (!gc) return undefined;
    return asDeckCard(gameDecks[gc.ownerId], gc);
  }, [cardId, gameView, gameDecks]);
}

export function usePromptSourceCard(): DeckCard | undefined {
  const sourceCardId = useGameStore((s) => s.currentPrompt?.sourceCardId);
  return useResolveDeckCard(sourceCardId);
}
