import { useMemo } from "react";

import { asDeckCard, getDeckCardPool } from "@/lib/decks";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { stackObjectToCardStub } from "@/components/game/game.utils";
import { peekArchivedToken, useCard } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { SourceCard } from "@/protocol";

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

export function useResolveSourceCard(source: SourceCard | undefined): DeckCard | undefined {
  const gameDecks = useGameStore((s) => s.gameDecks);
  const visible = useSourceCardDto(source?.engineId);
  const lookup = source?.lookup;
  const deckCard = useMemo(() => {
    if (visible?.identity.name) {
      const resolved = asDeckCard(gameDecks[visible.ownerId], visible);
      if (resolved.uris.normal || resolved.uris.border_crop) return resolved;
    }
    if (!lookup?.name) return undefined;
    const pool = Object.values(gameDecks).flatMap(getDeckCardPool);
    const exact = pool.find(
      (card) =>
        lookup.setCode &&
        lookup.cardNumber &&
        card.identity.setCode.toLowerCase() === lookup.setCode.toLowerCase() &&
        card.identity.cardNumber === lookup.cardNumber,
    );
    return (
      exact ??
      pool.find(
        (card) =>
          card.identity.name === lookup.name ||
          card.identity.name.split(" // ").includes(lookup.name),
      )
    );
  }, [gameDecks, lookup, visible]);
  const exact = useCard(
    deckCard || !lookup?.name
      ? null
      : {
          name: lookup.name,
          setCode: lookup.setCode || undefined,
          cardNumber: lookup.cardNumber || undefined,
        },
  );
  const byName = useCard(deckCard || !lookup?.name ? null : { name: lookup.name });
  const archivedToken = lookup?.isToken
    ? (peekArchivedToken({
        name: lookup.name,
        setCode: lookup.setCode,
        cardNumber: lookup.cardNumber,
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
