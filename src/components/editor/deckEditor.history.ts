import { useSyncExternalStore } from "react";

import { useDeckStore } from "@/stores/useDeckStore";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";

interface DeckHistoryEntry {
  label: string;
  before: EditorDeck;
  after: EditorDeck;
}

interface DeckHistoryState {
  undoLabel: string | null;
  redoLabel: string | null;
}

const undoStack: DeckHistoryEntry[] = [];
const redoStack: DeckHistoryEntry[] = [];
const listeners = new Set<() => void>();
let snapshot: DeckHistoryState = { undoLabel: null, redoLabel: null };

function cloneDeck(deck: EditorDeck): EditorDeck {
  return structuredClone(deck);
}

function decksMatch(left: EditorDeck, right: EditorDeck): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const CARD_COLLECTIONS = [
  "cards",
  "sideboard",
  "maybeboard",
  "attractions",
  "contraptions",
  "schemes",
  "planes",
  "commanders",
  "tokens",
] as const;

function rebaseDeckSnapshot(
  snapshot: EditorDeck,
  before: EditorDeck,
  after: EditorDeck,
): EditorDeck {
  const next = cloneDeck(snapshot);
  const nextCollections = next as EditorDeck &
    Record<(typeof CARD_COLLECTIONS)[number], DeckCard[] | undefined>;
  for (const collection of CARD_COLLECTIONS) {
    const snapshotCards = nextCollections[collection];
    const beforeCards = before[collection];
    const afterCards = after[collection];
    if (!snapshotCards || !beforeCards || !afterCards) continue;
    const beforeById = new Map(beforeCards.map((card) => [card.identity.id, card]));
    const afterById = new Map(afterCards.map((card) => [card.identity.id, card]));
    nextCollections[collection] = snapshotCards.map((card) => {
      const previous = beforeById.get(card.identity.id);
      const replacement = afterById.get(card.identity.id);
      return previous && replacement && JSON.stringify(card) === JSON.stringify(previous)
        ? structuredClone(replacement)
        : card;
    });
  }
  if (
    next.companion &&
    before.companion &&
    after.companion &&
    next.companion.identity.id === before.companion.identity.id &&
    JSON.stringify(next.companion) === JSON.stringify(before.companion)
  ) {
    next.companion = structuredClone(after.companion);
  }
  return next;
}

function publish() {
  snapshot = {
    undoLabel: undoStack.at(-1)?.label ?? null,
    redoLabel: redoStack.at(-1)?.label ?? null,
  };
  listeners.forEach((listener) => listener());
}

function recordDeckEdit(label: string, before: EditorDeck, after: EditorDeck) {
  let historyCleared = false;
  if (undoStack.length > 0 && !decksMatch(before, undoStack.at(-1)!.after)) {
    undoStack.length = 0;
    redoStack.length = 0;
    historyCleared = true;
  }
  if (decksMatch(before, after)) {
    if (historyCleared) publish();
    return;
  }
  undoStack.push({ label, before, after });
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  publish();
}

export function executeDeckEdit(label: string, edit: () => void) {
  const before = cloneDeck(useDeckStore.getState().currentDeck);
  edit();
  const after = cloneDeck(useDeckStore.getState().currentDeck);
  recordDeckEdit(label, before, after);
}

export function captureDeckEditSnapshot(): EditorDeck {
  return cloneDeck(useDeckStore.getState().currentDeck);
}

export function commitDeckEdit(label: string, before: EditorDeck) {
  recordDeckEdit(label, before, cloneDeck(useDeckStore.getState().currentDeck));
}

export function undoDeckEdit() {
  const entry = undoStack.pop();
  if (!entry) return;
  if (!decksMatch(useDeckStore.getState().currentDeck, entry.after)) {
    undoStack.length = 0;
    redoStack.length = 0;
    publish();
    return;
  }
  useDeckStore.setState({ currentDeck: cloneDeck(entry.before) });
  redoStack.push(entry);
  publish();
}

export function redoDeckEdit() {
  const entry = redoStack.pop();
  if (!entry) return;
  if (!decksMatch(useDeckStore.getState().currentDeck, entry.before)) {
    undoStack.length = 0;
    redoStack.length = 0;
    publish();
    return;
  }
  useDeckStore.setState({ currentDeck: cloneDeck(entry.after) });
  undoStack.push(entry);
  publish();
}

export function resetDeckHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  publish();
}

export function rebaseDeckHistory(before: EditorDeck, after: EditorDeck) {
  if (decksMatch(before, after)) return;
  for (const entry of [...undoStack, ...redoStack]) {
    entry.before = rebaseDeckSnapshot(entry.before, before, after);
    entry.after = rebaseDeckSnapshot(entry.after, before, after);
  }
}

export function useDeckHistoryState(): DeckHistoryState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
