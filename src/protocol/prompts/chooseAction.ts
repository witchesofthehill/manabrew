import type { ActivatableAbilityInfo } from "@/types/manabrew";

export type Type = "chooseAction";
export type PlayOption = {
  cardId: string;
  mode: string;
  modeLabel: string;
};
export type Input = {
  type: Type;
  playableCardIds: string[];
  playableOptions: PlayOption[];
  tappableLandIds: string[];
  untappableLandIds: string[];
  activatableAbilityIds: ActivatableAbilityInfo[];
  manaAbilityOptions: ActivatableAbilityInfo[];
};
export type Output =
  | { type: "pass"; untilPhase?: string | null }
  | { type: "concede" }
  | { type: "restoreSnapshot"; checkpointId: number }
  | { type: "playCard"; cardId: string; mode?: string | null }
  | { type: "activateAbility"; cardId: string; abilityIndex: number }
  | { type: "tapLand"; cardId: string; abilityIndex?: number | null; color?: string | null }
  | { type: "untapLand"; cardId: string };
