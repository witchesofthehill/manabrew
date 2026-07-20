import { useMemo } from "react";

import { asDeckCard, getDeckCardPool } from "@/lib/decks";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { peekArchivedToken, useCard } from "@/stores/useScryfallStore";
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

export function useResolveSourceCard(source: CardDto | undefined): DeckCard | undefined {
  const gameDecks = useGameStore((s) => s.gameDecks);
  const identity = source?.identity;
  const deckCard = useMemo(() => {
    if (source?.identity.name) {
      const resolved = asDeckCard(gameDecks[source.ownerId], source);
      if (resolved.uris.normal || resolved.uris.border_crop) return resolved;
    }
    if (!identity?.name) return undefined;
    const pool = Object.values(gameDecks).flatMap(getDeckCardPool);
    const exact = pool.find(
      (card) =>
        identity.setCode &&
        identity.cardNumber &&
        card.identity.setCode.toLowerCase() === identity.setCode.toLowerCase() &&
        card.identity.cardNumber === identity.cardNumber,
    );
    return (
      exact ??
      pool.find(
        (card) =>
          card.identity.name === identity.name ||
          card.identity.name.split(" // ").includes(identity.name),
      )
    );
  }, [gameDecks, identity, source]);
  const exact = useCard(
    deckCard || !identity?.name
      ? null
      : {
          name: identity.name,
          setCode: identity.setCode || undefined,
          cardNumber: identity.cardNumber || undefined,
        },
  );
  const byName = useCard(deckCard || !identity?.name ? null : { name: identity.name });
  const archivedToken = identity?.isToken
    ? (peekArchivedToken({
        name: identity.name,
        setCode: identity.setCode,
        cardNumber: identity.cardNumber,
      }) ?? undefined)
    : undefined;

  if (deckCard) return deckCard;
  if (exact) return scryfallToDeckCard(exact.info);
  if (archivedToken) return archivedToken;
  if (byName) return scryfallToDeckCard(byName.info);
  return undefined;
}

export function usePromptSourceCard(): DeckCard | undefined {
  const sourceCard = useGameStore((s) => s.currentPrompt?.sourceCard);
  return useResolveSourceCard(sourceCard);
}
