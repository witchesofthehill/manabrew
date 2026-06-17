import { useCard } from "@/stores/useScryfallStore";
import { resolveCardFaces, type ResolvedCardFaces } from "@/lib/cardFaces";

export function useCardFaces(lookup: {
  name?: string;
  setCode?: string;
  cardNumber?: string;
}): ResolvedCardFaces {
  const entry = useCard(lookup);
  return resolveCardFaces(entry?.info);
}
