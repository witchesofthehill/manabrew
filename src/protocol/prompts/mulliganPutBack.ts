import type { GameCard } from "@/types/manabrew";

export type Type = "mulliganPutBack";
export type Input = {
  type: Type;
  handCardIds: string[];
  cards: GameCard[];
  count: number;
};
export type Output = { type: "mulliganPutBackDecision"; cardIds: string[] };
