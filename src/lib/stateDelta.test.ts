import { describe, expect, it } from "vitest";

import cases from "./stateDelta.cases.json";
import { applyStateDelta, diffStateDelta } from "./stateDelta";

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

describe("diffStateDelta", () => {
  /** The only property the wire cares about: the patch rebuilds the board. */
  const roundTrip = (before: unknown, after: unknown) => {
    const patch = diffStateDelta(before, after);
    expect(patch === undefined ? before : applyStateDelta(before, patch)).toEqual(after);
    return patch;
  };

  it("says nothing when the board did not change", () => {
    expect(
      diffStateDelta({ a: 1, b: [{ id: "c1" }] }, { a: 1, b: [{ id: "c1" }] }),
    ).toBeUndefined();
    expect(diffStateDelta({ a: 1, b: 2 }, { b: 2, a: 1 })).toBeUndefined();
  });

  it("keeps real null fields instead of treating them as deletions", () => {
    roundTrip({ power: 2, toughness: null }, { power: null, toughness: 3 });
  });

  it("removes fields only when they are gone", () => {
    expect(roundTrip({ a: 1, b: 2 }, { a: 1 })).toEqual({ $d: ["b"] });
  });

  it("patches one card without resending the zone", () => {
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
        { zone: "graveyard", ownerId: "player-0", count: 0, cards: [] },
      ],
    };
    const after = structuredClone(before);
    after.zones[0].cards[1].tapped = true;
    const encoded = JSON.stringify(roundTrip(before, after));
    expect(encoded).not.toContain("long rules text");
    expect(encoded.length).toBeLessThan(120);
  });

  it("carries removals and reordering", () => {
    roundTrip([{ id: "a" }, { id: "b" }, { id: "c" }], [{ id: "c" }, { id: "a" }]);
  });

  it("adds a card that was not in the zone before", () => {
    roundTrip([{ id: "a" }], [{ id: "a" }, { id: "b", tapped: false }]);
  });

  it("replaces an array whose elements have no stable key", () => {
    roundTrip({ types: ["Land"] }, { types: ["Creature", "Artifact"] });
    roundTrip({ zones: [{ id: "a" }, { id: "a" }] }, { zones: [{ id: "a" }] });
  });

  it("replaces rather than merges when the shape changes", () => {
    roundTrip({ a: 1 }, { a: { b: 2 } });
    roundTrip({ a: { b: 2 } }, { a: 1 });
    roundTrip({ a: { b: 2 } }, { a: [{ id: "c1" }] });
    roundTrip({ a: [{ id: "c1" }] }, { a: { b: 2 } });
  });

  it("round-trips a hand emptying out and filling again", () => {
    roundTrip({ hand: [{ id: "c1" }, { id: "c2" }] }, { hand: [] });
    roundTrip({ hand: [] }, { hand: [{ id: "c1" }] });
  });

  it("survives a run of consecutive states", () => {
    const states = [
      { turn: 1, life: [20, 20], zones: [{ zone: "hand", ownerId: "p0", cards: [{ id: "c1" }] }] },
      { turn: 1, life: [20, 18], zones: [{ zone: "hand", ownerId: "p0", cards: [{ id: "c1" }] }] },
      { turn: 2, life: [20, 18], zones: [{ zone: "hand", ownerId: "p0", cards: [] }] },
      {
        turn: 2,
        life: [20, 18],
        zones: [
          { zone: "hand", ownerId: "p0", cards: [] },
          { zone: "battlefield", ownerId: "p0", cards: [{ id: "c1", tapped: true }] },
        ],
      },
    ];
    let held: unknown = states[0];
    for (const next of states.slice(1)) {
      const patch = diffStateDelta(held, next);
      held = patch === undefined ? held : applyStateDelta(held, patch);
      expect(held).toEqual(next);
    }
  });
});

/**
 * The same cases run against the Rust implementation in
 * `manabrew-relay-protocol::state_delta`. A patch a browser host writes is read
 * by the relay (to fold into the board it serves resyncs and old clients from)
 * and by every other seat, so the two implementations have to emit the same
 * bytes, not merely agree on the board.
 */
describe("shared patch cases", () => {
  for (const { name, before, after, patch } of cases) {
    it(name, () => {
      expect(diffStateDelta(before, after)).toEqual(patch);
      expect(applyStateDelta(before, patch)).toEqual(after);
    });
  }
});
