import { useSyncExternalStore } from "react";

import { useDeckStore } from "@/stores/useDeckStore";
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

function publish() {
  snapshot = {
    undoLabel: undoStack.at(-1)?.label ?? null,
    redoLabel: redoStack.at(-1)?.label ?? null,
  };
  listeners.forEach((listener) => listener());
}

export function executeDeckEdit(label: string, edit: () => void) {
  const before = cloneDeck(useDeckStore.getState().currentDeck);
  let historyCleared = false;
  if (undoStack.length > 0 && !decksMatch(before, undoStack.at(-1)!.after)) {
    undoStack.length = 0;
    redoStack.length = 0;
    historyCleared = true;
  }
  edit();
  const after = cloneDeck(useDeckStore.getState().currentDeck);
  if (decksMatch(before, after)) {
    if (historyCleared) publish();
    return;
  }
  undoStack.push({ label, before, after });
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  publish();
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

export function useDeckHistoryState(): DeckHistoryState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
