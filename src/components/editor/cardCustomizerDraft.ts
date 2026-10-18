import { cardCosmeticsKey, normalizeCardCosmetics, randomCardWearSeed } from "@/lib/cardCosmetics";
import { resolveCardWearAmount } from "@/lib/cardFinish";
import type { CardCosmetics, CardPrintingFace, DeckCard } from "@/protocol/deck";

export type CosmeticField =
  | "finish"
  | "frame"
  | "border"
  | "wearAmount"
  | "rainFog"
  | "cardstockAmount"
  | "printDotsAmount"
  | "printDotsPeriod"
  | "printDotsVariation"
  | "printDotsInset"
  | "finishCoverageArea"
  | "finishCoverageAmount";
export interface CardCustomizationDraft {
  source: DeckCard;
  cosmetics: CardCosmetics | undefined;
  foil: boolean;
  wearSeed: number | undefined;
}

export function createCustomizationDraft(card: DeckCard): CardCustomizationDraft {
  const cosmetics = normalizeCardCosmetics(card.identity.cosmetics);
  return {
    source: card,
    cosmetics,
    foil: !!card.identity.foil,
    wearSeed: cosmetics?.wearSeed,
  };
}

function resetPrintingFrame(layer: CardPrintingFace): CardPrintingFace {
  return {
    ...layer,
    preset: undefined,
    overrides: layer.overrides ? { ...layer.overrides, futureTreatment: undefined } : undefined,
    art:
      layer.art?.mode === "behind-text"
        ? { ...layer.art, mode: "window", paperOpacity: undefined }
        : layer.art,
  };
}

function resetPrintingBorder(layer: CardPrintingFace): CardPrintingFace {
  return {
    ...layer,
    overrides: layer.overrides ? { ...layer.overrides, borderColor: undefined } : undefined,
  };
}

export function changeCustomizationField(
  draft: CardCustomizationDraft,
  field: CosmeticField,
  value: string,
): CardCustomizationDraft {
  const cosmetics = draft.cosmetics;
  if (field === "cardstockAmount") {
    return {
      ...draft,
      cosmetics: normalizeCardCosmetics({ ...cosmetics, cardstock: { amount: Number(value) } }),
    };
  }
  if (
    field === "printDotsAmount" ||
    field === "printDotsPeriod" ||
    field === "printDotsVariation" ||
    field === "printDotsInset"
  ) {
    const key = {
      printDotsAmount: "amount",
      printDotsPeriod: "period",
      printDotsVariation: "variation",
      printDotsInset: "inset",
    }[field];
    return {
      ...draft,
      cosmetics: normalizeCardCosmetics({
        ...cosmetics,
        printDots: {
          ...cosmetics?.printDots,
          amount: cosmetics?.printDots?.amount ?? 0,
          [key]: Number(value),
        },
      }),
    };
  }
  if (field === "finishCoverageArea" || field === "finishCoverageAmount") {
    return {
      ...draft,
      cosmetics: normalizeCardCosmetics({
        ...cosmetics,
        finishCoverage:
          field === "finishCoverageArea"
            ? value === "native"
              ? undefined
              : { area: value, amount: cosmetics?.finishCoverage?.amount ?? 1 }
            : { area: cosmetics?.finishCoverage?.area ?? "full", amount: Number(value) },
      }),
    };
  }
  const wearSeed =
    field === "wearAmount" && Number(value) > 0
      ? (draft.wearSeed ?? randomCardWearSeed())
      : draft.wearSeed;
  const printing = draft.cosmetics?.printing;
  return {
    ...draft,
    wearSeed,
    foil:
      field === "finish"
        ? value === "printing"
          ? !!draft.source.identity.foil
          : value !== "regular"
        : draft.foil,
    cosmetics: normalizeCardCosmetics({
      ...draft.cosmetics,
      [field]:
        field === "rainFog" || field === "wearAmount"
          ? Number(value)
          : value === "printing"
            ? undefined
            : value,
      ...(field === "frame" && printing
        ? {
            printing: {
              ...resetPrintingFrame(printing),
              version: printing.version,
              preset: "match",
              faces: printing.faces?.map(resetPrintingFrame),
            },
          }
        : {}),
      ...(field === "border" && printing
        ? {
            printing: {
              ...resetPrintingBorder(printing),
              version: printing.version,
              preset: printing.preset,
              faces: printing.faces?.map(resetPrintingBorder),
            },
          }
        : {}),
      ...(field === "wearAmount"
        ? { wear: undefined, wearSeed: Number(value) > 0 ? wearSeed : undefined }
        : {}),
    }),
  };
}

export function customizationDraftChanged(draft: CardCustomizationDraft): boolean {
  return (
    draft.foil !== !!draft.source.identity.foil ||
    cardCosmeticsKey(draft.cosmetics) !== cardCosmeticsKey(draft.source.identity.cosmetics)
  );
}

export function customizationSourceChanged(source: DeckCard, current: DeckCard): boolean {
  return (
    source.identity.id !== current.identity.id ||
    source.identity.name !== current.identity.name ||
    source.identity.setCode !== current.identity.setCode ||
    source.identity.cardNumber !== current.identity.cardNumber ||
    !!source.identity.foil !== !!current.identity.foil ||
    cardCosmeticsKey(source.identity.cosmetics) !== cardCosmeticsKey(current.identity.cosmetics)
  );
}

export function customizationFieldValue(
  copies: readonly DeckCard[],
  drafts: ReadonlyMap<string, CardCustomizationDraft>,
  field: CosmeticField,
): string {
  const fallback =
    field === "rainFog" || field === "finishCoverageAmount"
      ? "1"
      : field === "cardstockAmount" || field === "printDotsAmount" || field === "printDotsInset"
        ? "0"
        : field === "printDotsPeriod"
          ? "5"
          : field === "printDotsVariation"
            ? "0.5"
            : field === "finishCoverageArea"
              ? "native"
              : "printing";
  const values = copies.map((copy) => {
    const draft = drafts.get(copy.identity.id);
    const cosmetics = draft ? draft.cosmetics : copy.identity.cosmetics;
    let value: string | number | undefined;
    switch (field) {
      case "wearAmount":
        value = resolveCardWearAmount(cosmetics);
        break;
      case "cardstockAmount":
        value = cosmetics?.cardstock?.amount;
        break;
      case "printDotsAmount":
        value = cosmetics?.printDots?.amount;
        break;
      case "printDotsPeriod":
        value = cosmetics?.printDots?.period;
        break;
      case "printDotsVariation":
        value = cosmetics?.printDots?.variation;
        break;
      case "printDotsInset":
        value = cosmetics?.printDots?.inset;
        break;
      case "finishCoverageArea":
        value = cosmetics?.finishCoverage?.area;
        break;
      case "finishCoverageAmount":
        value = cosmetics?.finishCoverage?.amount;
        break;
      default:
        value = cosmetics?.[field];
    }
    return String(value ?? fallback);
  });
  return values.some((value) => value !== values[0]) ? "mixed" : (values[0] ?? fallback);
}

export function customizationPreview(
  copy: DeckCard,
  drafts: ReadonlyMap<string, CardCustomizationDraft>,
): DeckCard {
  const draft = drafts.get(copy.identity.id);
  return draft
    ? { ...copy, identity: { ...copy.identity, foil: draft.foil, cosmetics: draft.cosmetics } }
    : copy;
}
