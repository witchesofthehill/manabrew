import type {
  CardCoating,
  CardCosmetics,
  CardFinish,
  CardFinishCoverage,
  CardPrintDots,
  Deck,
} from "@/protocol/deck";
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

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function normalizeCoating(value: unknown): CardCoating | undefined {
  const input = cosmeticRecord(value);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "amount") ||
    !boundedNumber(input.amount, 0, 1) ||
    input.amount === 0
  )
    return undefined;
  return { amount: input.amount };
}

function normalizePrintDots(value: unknown): CardPrintDots | undefined {
  const input = cosmeticRecord(value);
  if (
    !input ||
    Object.keys(input).some(
      (key) => !["amount", "period", "variation", "inset", "artwork"].includes(key),
    ) ||
    !boundedNumber(input.amount, 0, 1) ||
    (input.period != null && !boundedNumber(input.period, 2, 16)) ||
    (input.variation != null && !boundedNumber(input.variation, 0, 1)) ||
    (input.inset != null && !boundedNumber(input.inset, 0, 0.2)) ||
    (input.artwork != null && typeof input.artwork !== "boolean") ||
    input.amount === 0
  )
    return undefined;
  return {
    amount: input.amount,
    ...(input.period != null && input.period !== 5 ? { period: input.period as number } : {}),
    ...(input.variation != null && input.variation !== 0.5
      ? { variation: input.variation as number }
      : {}),
    ...(input.inset != null && input.inset !== 0 ? { inset: input.inset as number } : {}),
    ...(input.artwork === false ? { artwork: false } : {}),
  };
}

function normalizeFinishCoverage(value: unknown): CardFinishCoverage | undefined {
  const input = cosmeticRecord(value);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "area" && key !== "amount") ||
    !boundedNumber(input.amount, 0, 1) ||
    (input.area !== "full" &&
      input.area !== "artwork" &&
      input.area !== "left" &&
      input.area !== "right")
  )
    return undefined;
  return { area: input.area, amount: input.amount };
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
  if (boundedNumber(input.heatDeformation, 0, 0.02) && input.heatDeformation !== 0) {
    result.heatDeformation = input.heatDeformation;
  }
  const cardstock = normalizeCoating(input.cardstock);
  if (cardstock) result.cardstock = cardstock;
  const printDots = normalizePrintDots(input.printDots);
  if (printDots) result.printDots = printDots;
  const finishCoverage = normalizeFinishCoverage(input.finishCoverage);
  if (finishCoverage) result.finishCoverage = finishCoverage;
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

export function deckHasCardCosmetics(
  deck: Deck,
  matches?: (cosmetics: CardCosmetics) => boolean,
): boolean {
  const hasCosmetics = (value: unknown): boolean => {
    const cosmetics = normalizeCardCosmetics(value);
    return !!cosmetics && (!matches || matches(cosmetics));
  };
  return (
    [
      deck.cards,
      deck.sideboard,
      deck.maybeboard,
      deck.commanders,
      deck.attractions,
      deck.contraptions,
      deck.schemes,
      deck.planes,
      deck.tokens,
    ].some((cards) => cards?.some((card) => hasCosmetics(card.identity.cosmetics))) ||
    hasCosmetics(deck.companion?.identity.cosmetics)
  );
}
