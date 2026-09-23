import { resolveCardFaces } from "@/lib/cardFaces";
import { cardFaceImageUris, localizedDeckCardImageUris } from "@/lib/cardImage";
import { useCard, useScryfallStore } from "@/stores/useScryfallStore";
import { asDeckCard } from "@/lib/decks";
import { useGameStore } from "@/stores/useGameStore";
import type { CardDto } from "@/protocol/game";
import type { ScryfallImageSize } from "@/components/game/game.utils";
import { DEFAULT_SCRYFALL_LANGUAGE } from "@/i18n/locales";

export function useResolvedGameCard(card: CardDto) {
  const deck = useGameStore((state) => state.gameDecks[card.ownerId]);
  const deckCard = asDeckCard(deck, card);
  const locale = useScryfallStore((state) => state.locale);
  const entry = useCard({
    name: deckCard.identity.name || card.identity.name,
    setCode: deckCard.identity.setCode || undefined,
    cardNumber: deckCard.identity.cardNumber || undefined,
  });
  const cardFaces = resolveCardFaces(entry?.info);
  const imageUrl = (faceIndex: number, size: ScryfallImageSize) => {
    if (!entry) {
      return locale === DEFAULT_SCRYFALL_LANGUAGE &&
        deckCard.imageLanguage === DEFAULT_SCRYFALL_LANGUAGE
        ? localizedDeckCardImageUris(deckCard, locale, faceIndex)?.[size]
        : undefined;
    }
    return (
      localizedDeckCardImageUris(deckCard, locale, faceIndex, entry.info, entry.imageInfo)?.[
        size
      ] ?? cardFaceImageUris(entry.info, entry.uris, faceIndex, entry.imageInfo)?.[size]
    );
  };

  return { deckCard, cardFaces, imageUrl, info: entry?.info ?? null };
}
