import { useMemo, useState } from "react";
import {
  changeCustomizationField,
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

export function useCardCustomizerDraft(deck: EditorDeck, clicked: DeckCard, token = false) {
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
  const preview = active ? customizationPreview(active, drafts) : clicked;

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
  const resetSelected = () => {
    setDrafts((current) => {
      const next = new Map(current);
      for (const copy of selected) {
        const id = copy.identity.id;
        next.set(id, {
          ...(current.get(id) ?? createCustomizationDraft(copy)),
          cosmetics: undefined,
          foil: !!copy.identity.foil,
        });
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
    stale,
    editSelected,
    resetSelected,
    selectCopy,
    toggleCopy,
    selectQuantity,
  };
}
