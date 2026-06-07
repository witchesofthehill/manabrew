export type Type = "payCombatCost";
export type Input = {
  type: Type;
  attackerId: string;
  attackerName: string;
  cost: number;
  description: string;
  tappableLandIds: string[];
  untappableLandIds: string[];
  manaPoolTotal: number;
};
export type Output =
  | { type: "payCombatCost" }
  | { type: "declineCombatCost" }
  | { type: "tapLand"; cardId: string; abilityIndex?: number | null; color?: string | null }
  | { type: "untapLand"; cardId: string };
