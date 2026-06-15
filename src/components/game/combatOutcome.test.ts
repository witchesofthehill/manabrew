import { describe, it, expect } from "vitest";
import { computeCombatOutcome } from "./combatOutcome";
import type { GameCard } from "@/types/manabrew";

const card = (over: Partial<GameCard> & { id: string }): GameCard =>
  ({
    power: "0",
    toughness: "0",
    isAttacking: false,
    keywords: [],
    ...over,
  }) as GameCard;

describe("computeCombatOutcome", () => {
  it("kills the blocker when the attacker's power meets its toughness", () => {
    const atk = card({ id: "a", power: "3", toughness: "3", isAttacking: true });
    const blk = card({ id: "b", power: "1", toughness: "2" });
    const { doomedCardIds } = computeCombatOutcome(
      [atk, blk],
      [{ blockerId: "b", attackerId: "a" }],
    );
    expect(doomedCardIds.has("b")).toBe(true);
    expect(doomedCardIds.has("a")).toBe(false);
  });

  it("kills the attacker when blockers' combined power is lethal", () => {
    const atk = card({ id: "a", power: "2", toughness: "2", isAttacking: true });
    const b1 = card({ id: "b1", power: "1", toughness: "1" });
    const b2 = card({ id: "b2", power: "1", toughness: "1" });
    const { doomedCardIds } = computeCombatOutcome(
      [atk, b1, b2],
      [
        { blockerId: "b1", attackerId: "a" },
        { blockerId: "b2", attackerId: "a" },
      ],
    );
    expect(doomedCardIds.has("a")).toBe(true);
  });

  it("deathtouch kills regardless of toughness", () => {
    const atk = card({
      id: "a",
      power: "1",
      toughness: "1",
      isAttacking: true,
      keywords: ["Deathtouch"],
    });
    const blk = card({ id: "b", power: "0", toughness: "9" });
    const { doomedCardIds } = computeCombatOutcome(
      [atk, blk],
      [{ blockerId: "b", attackerId: "a" }],
    );
    expect(doomedCardIds.has("b")).toBe(true);
  });

  it("indestructible never dies", () => {
    const atk = card({ id: "a", power: "9", toughness: "1", isAttacking: true });
    const blk = card({ id: "b", power: "0", toughness: "1", keywords: ["Indestructible"] });
    const { doomedCardIds } = computeCombatOutcome(
      [atk, blk],
      [{ blockerId: "b", attackerId: "a" }],
    );
    expect(doomedCardIds.has("b")).toBe(false);
  });

  it("unblocked attackers report face damage", () => {
    const atk = card({ id: "a", power: "4", toughness: "4", isAttacking: true });
    const { attackerFaceDamage } = computeCombatOutcome([atk], []);
    expect(attackerFaceDamage.get("a")).toBe(4);
  });

  it("trample spills excess over the blocker to the face", () => {
    const atk = card({
      id: "a",
      power: "5",
      toughness: "5",
      isAttacking: true,
      keywords: ["Trample"],
    });
    const blk = card({ id: "b", power: "1", toughness: "2" });
    const { attackerFaceDamage } = computeCombatOutcome(
      [atk, blk],
      [{ blockerId: "b", attackerId: "a" }],
    );
    expect(attackerFaceDamage.get("a")).toBe(3);
  });
});
