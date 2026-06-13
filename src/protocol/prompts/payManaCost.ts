import type { ActivatableAbilityInfo } from "@/types/manabrew";

export type Type = "payManaCost";
export type Input = {
  type: Type;
  cardId: string;
  cardName: string;
  manaCost: string;
  manaAbilityOptions: ActivatableAbilityInfo[];
  tappableLandIds: string[];
  untappableLandIds: string[];
  manaPoolTotal: number;
  canConfirmFromPool: boolean;
};
export type Output =
  | { type: "payManaCost"; auto: boolean }
  | { type: "payLife" }
  | { type: "cancelManaCost" }
  | { type: "tapLand"; cardId: string; abilityIndex?: number | null; color?: string | null }
  | { type: "untapLand"; cardId: string };
