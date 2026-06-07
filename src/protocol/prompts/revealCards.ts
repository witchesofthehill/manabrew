import type { GameCard } from "@/types/manabrew";

export type Type = "revealCards";
export type Input = {
  type: Type;
  cards: GameCard[];
  zone: string;
  ownerPlayerId: string;
  message: string;
};
export type Output = { type: "revealCardsAcknowledged" };
