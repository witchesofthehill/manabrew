import { useMemo, useState } from "react";
import {
  changeCustomizationCalibration,
  changeCustomizationField,
  changeCustomizationPrinting,
  createCustomizationDraft,
  customizationDraftChanged,
  customizationPreview,
  customizationSourceChanged,
  type CardCustomizationDraft,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import type { CardPrintingCalibration, DeckCard } from "@/protocol/deck";
import { deriveTokens } from "@/lib/decks";
import { getCardCustomizationCopy } from "@/stores/useDeckStore";
import { tokenIdentityKey } from "@/stores/useScryfallStore";
import type { EditorDeck } from "@/types/manabrew";
import type { ScryfallCard } from "@/types/scryfall";

export interface CardCustomizerEditor {
  active: DeckCard | undefined;
  draft: CardCustomizationDraft | undefined;
  pending: boolean;
  preview: DeckCard;
  stale: boolean;
  edit: (field: CosmeticField, value: string) => void;
  editPrinting: (printing: ScryfallCard) => void;
  editCalibration: (value: CardPrintingCalibration | undefined, faceIndex?: 0 | 1) => void;
  reset: () => void;
}

export function useCardCustomizerDraft(
  deck: EditorDeck,
  clicked: DeckCard,
  token = false,
): CardCustomizerEditor {
  const active = useMemo(() => {
    if (!token) return getCardCustomizationCopy(deck, clicked.identity.id);
    const key = tokenIdentityKey(clicked);
    const produced = deriveTokens(deck).find((card) => tokenIdentityKey(card) === key);
    if (!produced) return undefined;
    return deck.tokens?.find((card) => tokenIdentityKey(card) === key) ?? produced;
  }, [deck, clicked, token]);
  const [draft, setDraft] = useState<CardCustomizationDraft>();
  const pending = !!draft && customizationDraftChanged(draft);
  const stale = !!draft && (!active || customizationSourceChanged(draft.source, active));
  const preview = useMemo(
    () => customizationPreview(active ?? clicked, draft),
    [active, clicked, draft],
  );

  const edit = (field: CosmeticField, value: string) => {
    if (!active || stale) return;
    setDraft((current) =>
      changeCustomizationField(current ?? createCustomizationDraft(active), field, value),
    );
  };
  const editPrinting = (printing: ScryfallCard) => {
    if (!active || stale) return;
    setDraft((current) =>
      changeCustomizationPrinting(current ?? createCustomizationDraft(active), printing),
    );
  };
  const editCalibration = (value: CardPrintingCalibration | undefined, faceIndex?: 0 | 1) => {
    if (!active || stale) return;
    setDraft((current) =>
      changeCustomizationCalibration(current ?? createCustomizationDraft(active), value, faceIndex),
    );
  };
  const reset = () => {
    if (!active || stale) return;
    setDraft((current) => {
      const next = current ?? createCustomizationDraft(active);
      return changeCustomizationField({ ...next, cosmetics: undefined }, "finish", "printing");
    });
  };

  return { active, draft, pending, preview, stale, edit, editPrinting, editCalibration, reset };
}
