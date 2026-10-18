import { cardCosmeticsKey, normalizeCardCosmetics, randomCardWearSeed } from "@/lib/cardCosmetics";
import { resolveCardWearAmount } from "@/lib/cardFinish";
import type { CardCosmetics, CardPrintingFace, DeckCard } from "@/protocol/deck";

export type CosmeticField = "finish" | "frame" | "border" | "wearAmount" | "rainFog";
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
  const fallback = field === "rainFog" ? "1" : "printing";
  const values = copies.map((copy) => {
    const draft = drafts.get(copy.identity.id);
    const cosmetics = draft ? draft.cosmetics : copy.identity.cosmetics;
    return field === "wearAmount"
      ? String(resolveCardWearAmount(cosmetics))
      : String(cosmetics?.[field] ?? fallback);
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
