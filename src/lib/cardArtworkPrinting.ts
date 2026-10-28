import type { ScryfallCard } from "@/types/scryfall";

export function hasIntegratedArtwork(card: ScryfallCard): boolean {
  const promoTypes: unknown = Reflect.get(card, "promo_types");
  return Array.isArray(promoTypes) && promoTypes.includes("poster");
}
