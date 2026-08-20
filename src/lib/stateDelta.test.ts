import { describe, expect, it } from "vitest";

import { applyStateDelta } from "./stateDelta";

describe("applyStateDelta", () => {
  it("keeps real null fields instead of treating them as deletions", () => {
    const before = { power: 2, toughness: null };
    const patch = { power: null, toughness: 3 };
    expect(applyStateDelta(before, patch)).toEqual({ power: null, toughness: 3 });
  });

  it("removes fields only when they are listed", () => {
    expect(applyStateDelta({ a: 1, b: 2 }, { $d: ["b"] })).toEqual({ a: 1 });
  });

  it("patches one card without touching the rest of the zone", () => {
    const before = {
      zones: [
        {
          zone: "battlefield",
          ownerId: "player-0",
          count: 2,
          cards: [
            { id: "c1", tapped: false, text: "a long rules text" },
            { id: "c2", tapped: false, text: "another long rules text" },
          ],
        },
      ],
    };
    const patch = {
      zones: { $k: { "battlefield/player-0": { cards: { $k: { c2: { tapped: true } } } } } },
    };
    expect(applyStateDelta(before, patch)).toEqual({
      zones: [
        {
          zone: "battlefield",
          ownerId: "player-0",
          count: 2,
          cards: [
            { id: "c1", tapped: false, text: "a long rules text" },
            { id: "c2", tapped: true, text: "another long rules text" },
          ],
        },
      ],
    });
  });

  it("carries removals and reordering", () => {
    const before = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const patch = { $d: ["b"], $o: ["c", "a"] };
    expect(applyStateDelta(before, patch)).toEqual([{ id: "c" }, { id: "a" }]);
  });

  it("adds a card that was not in the zone before", () => {
    const before = [{ id: "a" }];
    const patch = { $k: { b: { $v: { id: "b", tapped: false } } }, $o: ["a", "b"] };
    expect(applyStateDelta(before, patch)).toEqual([{ id: "a" }, { id: "b", tapped: false }]);
  });

  it("replaces an array that has no stable keys", () => {
    expect(applyStateDelta({ types: ["Land"] }, { types: ["Creature", "Artifact"] })).toEqual({
      types: ["Creature", "Artifact"],
    });
  });

  it("replaces rather than merges when the patch is a literal", () => {
    expect(applyStateDelta({ a: 1 }, { a: { $v: { b: 2 } } })).toEqual({ a: { b: 2 } });
  });
});
