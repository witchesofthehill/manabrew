import type { GameCard } from "@/types/manabrew";

export type Type = "reorderLibrary";
export type Input = {
  type: Type;
  cardIds: string[];
  cards: GameCard[];
  /** Destination zone; absent means the library. */
  destination?: string | null;
  /** For deck destinations: whether the cards go to the top (false = bottom). */
  topOfDeck?: boolean;
};
export type Output = { type: "reorderLibraryDecision"; orderedCardIds: string[] };
