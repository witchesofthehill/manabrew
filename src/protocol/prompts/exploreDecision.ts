import type { GameCard } from "@/types/manabrew";

export type Type = "exploreDecision";
export type Input = {
  type: Type;
  revealedCardName: string;
  revealedCard?: GameCard | null;
};
export type Output = { type: "exploreResponse"; putInGraveyard: boolean };
