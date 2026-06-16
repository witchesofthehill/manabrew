import { useMemo } from "react";

import { asDeckCard } from "@/lib/decks";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { useGameStore } from "@/stores/useGameStore";
import type { DeckCard, GameCard } from "@/types/manabrew";

// Resolves the card a prompt originates from (envelope `sourceCardId`) against
// the live game view, mirroring the resolution in Game.tsx. Prompt components
// take only { input, respond }; everything else they need comes from the store.
export function usePromptSourceCard(): DeckCard | undefined {
  const gameView = useGameStore((s) => s.gameView);
  const gameDecks = useGameStore((s) => s.gameDecks);
  const sourceCardId = useGameStore((s) => s.currentPrompt?.sourceCardId);

  return useMemo(() => {
    if (!sourceCardId || !gameView) return undefined;
    const visible: GameCard[] = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
    ];
    let gc = visible.find((c) => c.id === sourceCardId);
    if (!gc) {
      const stackObj = gameView.stack.find((s) => s.sourceId === sourceCardId);
      if (stackObj) gc = stackObjectToCardStub(stackObj);
    }
    if (!gc) return undefined;
    return asDeckCard(gameDecks[gc.ownerId], gc);
  }, [sourceCardId, gameView, gameDecks]);
}
