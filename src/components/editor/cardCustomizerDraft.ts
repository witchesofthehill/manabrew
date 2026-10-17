import { cardCosmeticsKey, normalizeCardCosmetics } from "@/lib/cardCosmetics";
import type { CardCosmetics, CardPrintingFace, DeckCard } from "@/protocol/deck";

export type CosmeticField = "finish" | "frame" | "border" | "wear";
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
    foil: cosmetics?.finish ? cosmetics.finish !== "regular" : !!card.identity.foil,
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

export function changeCustomizationField(
  draft: CardCustomizationDraft,
  field: CosmeticField,
  value: string,
): CardCustomizationDraft {
  const wearSeed =
    field === "wear" && value !== "fresh"
      ? (draft.wearSeed ?? (crypto.getRandomValues(new Uint32Array(1))[0] || 1))
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
      [field]: value === "printing" ? undefined : value,
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
      ...(field === "wear" ? { wearSeed: value === "fresh" ? undefined : wearSeed } : {}),
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
  const fallback = field === "wear" ? "fresh" : "printing";
  const values = copies.map((copy) => {
    const draft = drafts.get(copy.identity.id);
    const cosmetics = draft ? draft.cosmetics : copy.identity.cosmetics;
    return cosmetics?.[field] ?? fallback;
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
