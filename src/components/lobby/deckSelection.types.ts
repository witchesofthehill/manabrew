import type { Deck } from "@/protocol/deck";

export interface SelectedDeck {
  id: string;
  sourceId: string;
  name: string;
  desc?: string;
  color?: string;
  sourceDeck: Deck;
  source: "local" | "preset" | "hub";
  formatId?: string;
  commanderName?: string;
  coverCardName?: string;
}

export interface DeckAssignment {
  id: string;
  label: string;
  color: string;
}
