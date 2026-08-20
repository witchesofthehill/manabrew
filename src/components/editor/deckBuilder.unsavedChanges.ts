import { useEffect, useState } from "react";
import { useDeckStore } from "@/stores/useDeckStore";
import type { EditorDeck } from "@/types/manabrew";

let _hasUnsavedChanges = false;
const _listeners = new Set<() => void>();
let _lastSavedDeckRef: EditorDeck | null = null;

export function setUnsavedState(snapshot: string, current: string) {
  const next = current !== snapshot;
  if (next !== _hasUnsavedChanges) {
    _hasUnsavedChanges = next;
    _listeners.forEach((fn) => fn());
  }
}

export function setLastSavedDeckRef(deck: EditorDeck | null) {
  _lastSavedDeckRef = deck;
}

export function buildDeckSnapshot(deck: EditorDeck): string {
  const cardIdentity = (card: EditorDeck["cards"][number]) => card.identity;
  const cardIdentities = (cards: EditorDeck["cards"] | undefined) => cards?.map(cardIdentity) ?? [];
  return JSON.stringify({
    format: deck.format,
    draft: deck.draft,
    cards: cardIdentities(deck.cards),
    commanders: cardIdentities(deck.commanders),
    sideboard: cardIdentities(deck.sideboard),
    maybeboard: cardIdentities(deck.maybeboard),
    attractions: cardIdentities(deck.attractions),
    contraptions: cardIdentities(deck.contraptions),
    schemes: cardIdentities(deck.schemes),
    planes: cardIdentities(deck.planes),
    companion: deck.companion?.identity,
    tokens: cardIdentities(deck.tokens),
    name: deck.name,
    labels: deck.labels ?? [],
    customTags: deck.customTags ?? [],
    cardTags: deck.cardTags ?? {},
    coverCardName: deck.coverCardName,
    coverCardFace: deck.coverCardFace,
    playmat: deck.playmat,
    playmatSettings: deck.playmatSettings,
    stackPositions: deck.stackPositions,
    editor: deck.editor,
  });
}

export function useDeckUnsavedChanges(): boolean {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);
  return _hasUnsavedChanges;
}

export function revertDeckToLastSaved() {
  if (!_lastSavedDeckRef) return;
  useDeckStore.getState().loadDeck(_lastSavedDeckRef);
}
