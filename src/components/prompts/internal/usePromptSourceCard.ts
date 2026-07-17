import { useMemo } from "react";

import { asDeckCard } from "@/lib/decks";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { useGameStore } from "@/stores/useGameStore";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";

export function useSourceCardDto(cardId: string | undefined): CardDto | undefined {
  const gameView = useGameStore((s) => s.gameView);

  return useMemo(() => {
    if (!cardId || !gameView) return undefined;
    const visible: CardDto[] = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
    ];
    const gc = visible.find((c) => c.id === cardId);
    if (gc) return gc;
    const stackObj = gameView.stack.find((s) => s.sourceId === cardId);
    return stackObj ? (stackObjectToCardStub(stackObj) as CardDto) : undefined;
  }, [cardId, gameView]);
}

export function useResolveDeckCard(cardId: string | undefined): DeckCard | undefined {
  const gameDecks = useGameStore((s) => s.gameDecks);
  const gc = useSourceCardDto(cardId);
  return useMemo(() => (gc ? asDeckCard(gameDecks[gc.ownerId], gc) : undefined), [gc, gameDecks]);
}

export function usePromptSourceCard(): DeckCard | undefined {
  const sourceCardId = useGameStore((s) => s.currentPrompt?.sourceCardId);
  return useResolveDeckCard(sourceCardId);
}
