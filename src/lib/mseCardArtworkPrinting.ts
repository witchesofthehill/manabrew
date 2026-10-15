import type { ScryfallCard } from "@/types/scryfall";

function tags(card: ScryfallCard, key: string): string[] {
  const value: unknown = Reflect.get(card, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function hasIntegratedArtwork(card: ScryfallCard): boolean {
  return (
    tags(card, "promo_types").includes("poster") ||
    (card.set === "sld" &&
      (!card.frame || card.frame === "2015") &&
      !tags(card, "frame_effects").includes("extendedart"))
  );
}
