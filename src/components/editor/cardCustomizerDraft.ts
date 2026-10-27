import { cardCosmeticsKey, normalizeCardCosmetics, randomCardWearSeed } from "@/lib/cardCosmetics";
import { resolveCardWearAmount } from "@/lib/cardFinish";
import type { CardCosmetics, CardPrintingFace, DeckCard } from "@/protocol/deck";
import { availablePrintingFoil, getCardPrintingPatch } from "@/stores/useDeckStore";
import type { ScryfallCard } from "@/types/scryfall";

export type CosmeticField =
  | "finish"
  | "frame"
  | "border"
  | "wearAmount"
  | "rainFog"
  | "heatDeformation"
  | "cardstockAmount"
  | "printDotsAmount"
  | "printDotsInset"
  | "printDotsArtwork";
export interface CardCustomizationDraft {
  source: DeckCard;
  printing?: ScryfallCard;
  cosmetics: CardCosmetics | undefined;
  foil: boolean;
  wearSeed: number | undefined;
  finishEdited?: boolean;
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

export function changeCustomizationPrinting(
  draft: CardCustomizationDraft,
  printing: ScryfallCard,
): CardCustomizationDraft {
  const original =
    printing.set === draft.source.identity.setCode &&
    printing.collector_number === draft.source.identity.cardNumber;
  return {
    ...draft,
    printing: original ? undefined : printing,
    foil:
      draft.finishEdited && draft.cosmetics?.finish
        ? draft.cosmetics.finish !== "regular"
        : original
          ? !!draft.source.identity.foil
          : availablePrintingFoil(draft.source.identity, printing),
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
  if (field === "printDotsAmount" || field === "printDotsInset" || field === "printDotsArtwork") {
    const key = {
      printDotsAmount: "amount",
      printDotsInset: "inset",
      printDotsArtwork: "artwork",
    }[field];
    return {
      ...draft,
      cosmetics: normalizeCardCosmetics({
        ...cosmetics,
        printDots: {
          ...cosmetics?.printDots,
          amount: cosmetics?.printDots?.amount ?? 0,
          [key]: field === "printDotsArtwork" ? value === "true" : Number(value),
        },
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
    finishEdited: field === "finish" ? true : draft.finishEdited,
    foil:
      field === "finish"
        ? value === "printing"
          ? draft.printing
            ? availablePrintingFoil(draft.source.identity, draft.printing)
            : !!draft.source.identity.foil
          : value !== "regular"
        : draft.foil,
    cosmetics: normalizeCardCosmetics({
      ...draft.cosmetics,
      [field]:
        field === "rainFog" || field === "heatDeformation" || field === "wearAmount"
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
    (draft.printing !== undefined &&
      (draft.printing.set !== draft.source.identity.setCode ||
        draft.printing.collector_number !== draft.source.identity.cardNumber)) ||
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
  cosmetics: CardCosmetics | undefined,
  field: CosmeticField,
): string {
  const fallback =
    field === "rainFog"
      ? "1"
      : field === "cardstockAmount" ||
          field === "printDotsAmount" ||
          field === "printDotsInset" ||
          field === "heatDeformation"
        ? "0"
        : "printing";
  let value: string | number | boolean | undefined;
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
    case "printDotsInset":
      value = cosmetics?.printDots?.inset;
      break;
    case "printDotsArtwork":
      value = cosmetics?.printDots?.artwork ?? true;
      break;
    default:
      value = cosmetics?.[field];
  }
  return String(value ?? fallback);
}

export function customizationPreview(copy: DeckCard, draft?: CardCustomizationDraft): DeckCard {
  if (!draft) return copy;
  const patch = draft.printing ? getCardPrintingPatch(draft.printing) : undefined;
  return {
    ...copy,
    ...patch,
    identity: {
      ...copy.identity,
      ...patch?.identity,
      foil: draft.foil,
      cosmetics: draft.cosmetics,
    },
  };
}
