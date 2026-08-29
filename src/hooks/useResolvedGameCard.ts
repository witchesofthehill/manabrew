import { useCardFaces } from "@/hooks/useCardFaces";
import { asDeckCard } from "@/lib/decks";
import { useGameStore } from "@/stores/useGameStore";
import type { CardDto } from "@/protocol/game";
import type { ScryfallImageSize } from "@/components/game/game.utils";

export function useResolvedGameCard(card: CardDto) {
  const deck = useGameStore((state) => state.gameDecks[card.ownerId]);
  const deckCard = asDeckCard(deck, card);
  const cardFaces = useCardFaces({
    name: deckCard.identity.name || card.identity.name,
    setCode: deckCard.identity.setCode || undefined,
    cardNumber: deckCard.identity.cardNumber || undefined,
  });
  const imageUrl = (faceIndex: number, size: ScryfallImageSize) =>
    faceIndex === 0
      ? (deckCard.uris?.[size] ?? cardFaces.faces[0]?.imageUris?.[size])
      : (cardFaces.faces[faceIndex]?.imageUris?.[size] ?? deckCard.uris?.[size]);

  return { deckCard, cardFaces, imageUrl };
}
