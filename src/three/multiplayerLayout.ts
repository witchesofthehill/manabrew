import type { ArenaCard } from "@/three/arena.types";

export type CardPlacement = {
  x: number;
  y: number;
  z: number;
  angle: number;
  scale: number;
  pileCount?: number;
};

export function multiplayerSeat(cards: ArenaCard[], seat: number) {
  const positions = new Map<string, CardPlacement>();
  const center = (seat - 1) * 7;
  const hand = cards.filter((c) => c.side === "opponentHand");
  hand.forEach((card, i) => {
    const x = (i - (hand.length - 1) / 2) * Math.min(0.55, 3.5 / Math.max(hand.length, 1));
    positions.set(card.id, {
      x: center - 0.6 + x,
      y: 0.4 + i * 0.025,
      z: -10,
      angle: Math.PI + x * 0.05,
      scale: 0.5,
    });
  });
  const permanents = cards.filter((c) => c.side === "opponent");
  const creatures = permanents.filter((c) => !/land/i.test(c.type) || /creature/i.test(c.type));
  const columns = creatures.length > 6 ? 4 : 3;
  const rows = Math.max(1, Math.ceil(creatures.length / columns));
  const scale = Math.min(0.82, 6.1 / (columns * 2.55), 3.2 / (rows * 2.25));
  creatures.forEach((card, i) => {
    const row = Math.floor(i / columns);
    const count = Math.min(columns, creatures.length - row * columns);
    positions.set(card.id, {
      x: center + ((i % columns) - (count - 1) / 2) * 2.55 * scale,
      y: -0.15,
      z: -0.5 - row * 2.25 * scale - (card.attacking ? -0.35 : 0),
      angle: card.tapped ? -0.14 : 0,
      scale,
    });
  });
  const groups: ArenaCard[][] = [];
  const matching = new Map<string, ArenaCard[]>();
  for (const card of permanents.filter((c) => /land/i.test(c.type) && !/creature/i.test(c.type))) {
    const key = JSON.stringify([
      card.name,
      card.text,
      card.frame,
      !!card.tapped,
      card.selected || card.attachmentNames?.length ? card.id : "",
    ]);
    let pile = matching.get(key);
    if (!pile || pile.length === 4) {
      pile = [];
      matching.set(key, pile);
      groups.push(pile);
    }
    pile.push(card);
  }
  const landRows = Math.max(1, Math.ceil(groups.length / 3));
  const landScale = Math.min(0.66, 2.3 / (landRows * 2.4));
  groups.forEach((pile, i) =>
    pile.forEach((card, depth) => {
      const count = Math.min(3, groups.length - Math.floor(i / 3) * 3);
      positions.set(card.id, {
        x: center + ((i % 3) - (count - 1) / 2) * 2.05 + depth * 0.12,
        y: -0.12 + depth * 0.045,
        z: -4.5 - Math.floor(i / 3) * 2.4 * landScale - depth * 0.1,
        angle: card.tapped ? -0.14 : 0,
        scale: landScale,
        pileCount: depth === pile.length - 1 && pile.length > 1 ? pile.length : undefined,
      });
    }),
  );
  return positions;
}
