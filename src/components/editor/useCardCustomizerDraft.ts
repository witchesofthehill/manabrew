import { useMemo, useState } from "react";
import {
  changeCustomizationField,
  changeCustomizationPrinting,
  createCustomizationDraft,
  customizationDraftChanged,
  customizationPreview,
  customizationSourceChanged,
  type CardCustomizationDraft,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import type { DeckCard } from "@/protocol/deck";
import { getCardCustomizationCopies } from "@/stores/useDeckStore";
import type { EditorDeck } from "@/types/manabrew";
import type { ScryfallCard } from "@/types/scryfall";

export interface CardCustomizerEditor {
  copies: readonly DeckCard[];
  active: DeckCard | undefined;
  activeId: string;
  selected: readonly DeckCard[];
  selectedIds: ReadonlySet<string>;
  drafts: ReadonlyMap<string, CardCustomizationDraft>;
  pending: readonly [string, CardCustomizationDraft][];
  pendingIds: ReadonlySet<string>;
  preview: DeckCard;
  previewCopies: readonly DeckCard[];
  stale: boolean;
  editSelected: (field: CosmeticField, value: string) => void;
  editPrinting: (printing: ScryfallCard) => void;
  resetSelected: () => void;
  selectCopy: (id: string) => void;
  toggleCopy: (id: string) => void;
  selectQuantity: (quantity: number) => void;
}

export function useCardCustomizerDraft(
  deck: EditorDeck,
  clicked: DeckCard,
  token = false,
): CardCustomizerEditor {
  const [activeId, setActiveId] = useState(clicked.identity.id);
  const [selectedIds, setSelectedIds] = useState(() => new Set([clicked.identity.id]));
  const copies = useMemo(
    () => (token ? [clicked] : getCardCustomizationCopies(deck, clicked)),
    [deck, clicked, token],
  );
  const [drafts, setDrafts] = useState(() => new Map<string, CardCustomizationDraft>());
  const active = copies.find((copy) => copy.identity.id === activeId);
  const selected = copies.filter((copy) => selectedIds.has(copy.identity.id));
  const pending = [...drafts.entries()].filter(([, draft]) => customizationDraftChanged(draft));
  const stale = pending.some(([id, draft]) => {
    const current = copies.find((copy) => copy.identity.id === id);
    return !current || customizationSourceChanged(draft.source, current);
  });
  const pendingIds = new Set(pending.map(([id]) => id));
  const previewCopies = useMemo<readonly DeckCard[]>(
    () => copies.map((copy) => customizationPreview(copy, drafts)),
    [copies, drafts],
  );
  const preview = previewCopies.find((copy) => copy.identity.id === activeId) ?? clicked;

  const editSelected = (field: CosmeticField, value: string) => {
    setDrafts((current) => {
      const next = new Map(current);
      for (const copy of selected) {
        const id = copy.identity.id;
        next.set(
          id,
          changeCustomizationField(current.get(id) ?? createCustomizationDraft(copy), field, value),
        );
      }
      return next;
    });
  };
  const editPrinting = (printing: ScryfallCard) => {
    setDrafts((current) => {
      const next = new Map(current);
      for (const copy of selected) {
        const id = copy.identity.id;
        next.set(
          id,
          changeCustomizationPrinting(current.get(id) ?? createCustomizationDraft(copy), printing),
        );
      }
      return next;
    });
  };
  const resetSelected = () => {
    setDrafts((current) => {
      const next = new Map(current);
      for (const copy of selected) {
        const id = copy.identity.id;
        const draft = current.get(id) ?? createCustomizationDraft(copy);
        next.set(
          id,
          changeCustomizationField({ ...draft, cosmetics: undefined }, "finish", "printing"),
        );
      }
      return next;
    });
  };
  const selectCopy = (id: string) => {
    setActiveId(id);
    setSelectedIds(new Set([id]));
  };
  const toggleCopy = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectQuantity = (quantity: number) => {
    const ordered = active && !token ? getCardCustomizationCopies(deck, active) : copies;
    setSelectedIds(new Set(ordered.slice(0, quantity).map((copy) => copy.identity.id)));
  };

  return {
    copies,
    active,
    activeId,
    selected,
    selectedIds,
    drafts,
    pending,
    pendingIds,
    preview,
    previewCopies,
    stale,
    editSelected,
    editPrinting,
    resetSelected,
    selectCopy,
    toggleCopy,
    selectQuantity,
  };
}
