import { describe, it, expect } from "vitest";
import { isAttackerTap } from "./combatRouting";
import type { BattlefieldState } from "../types";

const stateWith = (attackingCardIds?: string[]): BattlefieldState =>
  ({ cards: [], attackingCardIds }) as BattlefieldState;

describe("isAttackerTap", () => {
  it("routes a tapped attacking opponent creature to the attacker handler", () => {
    expect(isAttackerTap(stateWith(["a1", "a2"]), "a1")).toBe(true);
  });

  it("treats a non-attacking opponent card as a normal click", () => {
    expect(isAttackerTap(stateWith(["a1"]), "c2")).toBe(false);
  });

  it("is false when no creatures are attacking", () => {
    expect(isAttackerTap(stateWith(), "a1")).toBe(false);
    expect(isAttackerTap(stateWith([]), "a1")).toBe(false);
  });

  it("is false when there is no battlefield state yet", () => {
    expect(isAttackerTap(null, "a1")).toBe(false);
  });
});
