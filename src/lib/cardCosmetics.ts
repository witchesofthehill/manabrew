import type { CardCosmetics, CardFinish, Deck } from "@/protocol/deck";

const FINISHES: Record<CardFinish, true> = {
  regular: true,
  gloss: true,
  etched: true,
  prismatic: true,
  cold: true,
  opal: true,
  rain: true,
  heat: true,
  pool: true,
};
const MAX_WEAR_SEED = 0xffffffff;

export function normalizeCardCosmetics(value: unknown): CardCosmetics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const result: CardCosmetics = {};
  if (typeof input.finish === "string" && Object.hasOwn(FINISHES, input.finish)) {
    result.finish = input.finish as CardFinish;
  }
  if (input.frame === "modern" || input.frame === "retro") result.frame = input.frame;
  if (input.border === "black" || input.border === "white" || input.border === "silver") {
    result.border = input.border;
  }
  if (input.wear === "light" || input.wear === "played" || input.wear === "heavy") {
    result.wear = input.wear;
    if (
      typeof input.wearSeed === "number" &&
      Number.isInteger(input.wearSeed) &&
      input.wearSeed > 0 &&
      input.wearSeed <= MAX_WEAR_SEED
    ) {
      result.wearSeed = input.wearSeed;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function cardCosmeticsKey(cosmetics?: CardCosmetics): string {
  const value = normalizeCardCosmetics(cosmetics);
  if (!value) return "";
  return [
    value.finish ?? "",
    value.frame ?? "",
    value.border ?? "",
    value.wear ?? "",
    value.wearSeed ?? 0,
  ].join(":");
}

export function deckHasCardCosmetics(deck: Deck): boolean {
  return (
    [
      deck.cards,
      deck.sideboard,
      deck.commanders,
      deck.attractions,
      deck.contraptions,
      deck.schemes,
      deck.planes,
      deck.tokens,
    ].some((cards) => cards?.some((card) => normalizeCardCosmetics(card.identity.cosmetics))) ||
    !!normalizeCardCosmetics(deck.companion?.identity.cosmetics)
  );
}
