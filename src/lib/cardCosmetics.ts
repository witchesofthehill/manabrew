import type { CardCosmetics, CardFinish, Deck } from "@/protocol/deck";
import { cosmeticRecord, normalizeCardPrintingSelection } from "@/lib/cardPrintingCosmetics";

const FINISHES: Record<CardFinish, true> = {
  regular: true,
  gloss: true,
  etched: true,
  prismatic: true,
  holofoil: true,
  cold: true,
  opal: true,
  rain: true,
  heat: true,
  pool: true,
};
const MAX_WEAR_SEED = 0xffffffff;

export function randomCardWearSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
}

export function normalizeCardCosmetics(value: unknown): CardCosmetics | undefined {
  const input = cosmeticRecord(value);
  if (!input) return undefined;
  const result: CardCosmetics = {};
  if (typeof input.finish === "string" && Object.hasOwn(FINISHES, input.finish)) {
    result.finish = input.finish as CardFinish;
  }
  if (input.frame === "modern" || input.frame === "retro") result.frame = input.frame;
  if (input.border === "black" || input.border === "white" || input.border === "silver") {
    result.border = input.border;
  }
  if (
    typeof input.wearAmount === "number" &&
    Number.isFinite(input.wearAmount) &&
    input.wearAmount >= 0 &&
    input.wearAmount <= 1
  ) {
    if (input.wearAmount > 0) result.wearAmount = input.wearAmount;
  } else if (input.wear === "light" || input.wear === "played" || input.wear === "heavy") {
    result.wear = input.wear;
  }
  if (result.wear || result.wearAmount) {
    if (
      typeof input.wearSeed === "number" &&
      Number.isInteger(input.wearSeed) &&
      input.wearSeed > 0 &&
      input.wearSeed <= MAX_WEAR_SEED
    ) {
      result.wearSeed = input.wearSeed;
    }
  }
  if (
    typeof input.rainFog === "number" &&
    Number.isFinite(input.rainFog) &&
    input.rainFog >= 0 &&
    input.rainFog <= 2 &&
    input.rainFog !== 1
  ) {
    result.rainFog = input.rainFog;
  }
  if (input.wording === "original") result.wording = "original";
  const printing = normalizeCardPrintingSelection(input.printing);
  if (printing) {
    result.printing = printing;
    if (printing.preset !== "match") delete result.frame;
  }
  return Object.keys(result).length ? result : undefined;
}

export function cardCosmeticsKey(cosmetics?: CardCosmetics): string {
  const value = normalizeCardCosmetics(cosmetics);
  if (!value) return "";
  return JSON.stringify(value);
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
