import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorDeck } from "@/types/manabrew";

const deckState = vi.hoisted(() => ({
  currentDeck: {
    name: "History test",
    cards: [],
    sideboard: [],
  } as EditorDeck,
}));

vi.mock("@/stores/useDeckStore", () => ({
  useDeckStore: {
    getState: () => deckState,
    setState: (update: Partial<typeof deckState>) => Object.assign(deckState, update),
  },
}));

import {
  executeDeckEdit,
  redoDeckEdit,
  resetDeckHistory,
  undoDeckEdit,
} from "./deckEditor.history";

describe("deck editor history", () => {
  beforeEach(() => {
    deckState.currentDeck = { name: "History test", cards: [], sideboard: [] };
    resetDeckHistory();
  });

  it("undoes and redoes a complete editor transaction", () => {
    executeDeckEdit("Rename deck", () => {
      deckState.currentDeck = { ...deckState.currentDeck, name: "Changed" };
    });

    expect(deckState.currentDeck.name).toBe("Changed");
    undoDeckEdit();
    expect(deckState.currentDeck.name).toBe("History test");
    redoDeckEdit();
    expect(deckState.currentDeck.name).toBe("Changed");
  });

  it("does not record edits that leave the deck unchanged", () => {
    executeDeckEdit("No change", () => undefined);
    undoDeckEdit();

    expect(deckState.currentDeck.name).toBe("History test");
  });

  it("drops stale history after an external deck replacement", () => {
    executeDeckEdit("Rename deck", () => {
      deckState.currentDeck = { ...deckState.currentDeck, name: "Changed" };
    });
    deckState.currentDeck = { ...deckState.currentDeck, name: "Account version" };

    undoDeckEdit();
    expect(deckState.currentDeck.name).toBe("Account version");
  });
});
