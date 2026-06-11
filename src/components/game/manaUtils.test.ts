import { describe, expect, it } from "vitest";

import { getExpandedManaAbilities } from "@/components/game/manaUtils";
import type { ActivatableAbilityInfo } from "@/types/manabrew";

function ability(partial: Partial<ActivatableAbilityInfo>): ActivatableAbilityInfo {
  return {
    cardId: "black-lotus",
    abilityIndex: 0,
    description: "Black Lotus",
    isManaAbility: true,
    ...partial,
  };
}

describe("getExpandedManaAbilities", () => {
  it("expands produced any-color mana into color choices", () => {
    const expanded = getExpandedManaAbilities("black-lotus", [ability({ cost: "Any Any Any" })]);

    expect(expanded.map((option) => option.description)).toEqual([
      "Add {W}",
      "Add {U}",
      "Add {B}",
      "Add {R}",
      "Add {G}",
    ]);
  });

  it("labels single-color produced mana when the description is just the source", () => {
    const expanded = getExpandedManaAbilities("black-lotus", [ability({ cost: "G" })]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0].description).toBe("Add {G}");
  });
});
