import { describe, it, expect } from "vitest";
import { canBlockAttacker } from "./combatLegality";
import type { BlockableAttackerDto } from "@/protocol";

const att = (attackerId: string, validBlockerIds: string[]): BlockableAttackerDto => ({
  attackerId,
  validBlockerIds,
  minBlockers: 1,
  mustBeBlocked: false,
});

describe("canBlockAttacker", () => {
  it("allows a blocker the engine lists for the attacker", () => {
    expect(canBlockAttacker([att("a", ["b1", "b2"])], "b1", "a")).toBe(true);
  });

  it("rejects a blocker not in the attacker's valid list", () => {
    expect(canBlockAttacker([att("a", ["b1"])], "b2", "a")).toBe(false);
  });

  it("rejects an unknown attacker", () => {
    expect(canBlockAttacker([att("a", ["b1"])], "b1", "missing")).toBe(false);
  });

  it("rejects an attacker that lists no valid blockers (unblockable)", () => {
    expect(canBlockAttacker([att("a", [])], "b1", "a")).toBe(false);
  });
});
