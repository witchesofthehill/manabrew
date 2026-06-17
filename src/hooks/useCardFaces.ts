import { useCard } from "@/stores/useScryfallStore";
import { resolveCardFaces, type ResolvedCardFaces } from "@/lib/cardFaces";

/**
 * Resolves a card's faces from the Scryfall store, fetching the card if it
 * isn't cached. The single hook every double-faced UI uses to know whether a
 * card flips and what each face's name / image is.
 */
export function useCardFaces(lookup: {
  name?: string;
  setCode?: string;
  cardNumber?: string;
}): ResolvedCardFaces {
  const entry = useCard(lookup);
  return resolveCardFaces(entry?.info);
}
