import { cardCosmeticsKey, normalizeCardCosmetics } from "@/lib/cardCosmetics";
import type { CardCosmetics, DeckCard } from "@/protocol/deck";

export type CosmeticField = "finish" | "frame" | "border" | "wear";
export interface CardCustomizationDraft {
  source: DeckCard;
  cosmetics: CardCosmetics | undefined;
  wearSeed: number | undefined;
}

export function createCustomizationDraft(card: DeckCard): CardCustomizationDraft {
  const cosmetics = normalizeCardCosmetics(card.identity.cosmetics);
  return { source: card, cosmetics, wearSeed: cosmetics?.wearSeed };
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
  return {
    ...draft,
    wearSeed,
    cosmetics: normalizeCardCosmetics({
      ...draft.cosmetics,
      [field]: value === "printing" ? undefined : value,
      ...(field === "wear" ? { wearSeed: value === "fresh" ? undefined : wearSeed } : {}),
    }),
  };
}

export function customizationDraftChanged(draft: CardCustomizationDraft): boolean {
  return cardCosmeticsKey(draft.cosmetics) !== cardCosmeticsKey(draft.source.identity.cosmetics);
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
  const values = copies.map((copy) => {
    const draft = drafts.get(copy.identity.id);
    const cosmetics = draft ? draft.cosmetics : copy.identity.cosmetics;
    return cosmetics?.[field] ?? (field === "wear" ? "fresh" : "printing");
  });
  return values.some((value) => value !== values[0])
    ? "mixed"
    : (values[0] ?? (field === "wear" ? "fresh" : "printing"));
}

export function customizationPreview(
  copy: DeckCard,
  drafts: ReadonlyMap<string, CardCustomizationDraft>,
): DeckCard {
  const draft = drafts.get(copy.identity.id);
  return draft ? { ...copy, identity: { ...copy.identity, cosmetics: draft.cosmetics } } : copy;
}
