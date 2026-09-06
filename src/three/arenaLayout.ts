import type { ArenaCard } from "@/three/arena.types";
import { multiplayerSeat } from "@/three/multiplayerLayout";

export function arenaLayout(cards: ArenaCard[]): Map<string, { x: number; y: number; z: number; angle: number; scale: number; pileCount?: number }> {
  const opponents = [...new Set(cards.filter((c) => c.side === "opponent" || c.side === "opponentHand").map((c) => c.playerId).filter(Boolean))];
  if (opponents.length > 0) {
    const result = arenaLayout(cards.filter((c) => c.side === "self" || c.side === "hand"));
    for (const player of opponents) {
      const seat = Number(player!.split("-").at(-1)) - 1;
      for (const [id, position] of multiplayerSeat(cards.filter((c) => c.playerId === player), seat)) result.set(id, position);
    }
    return result;
  }
  const positions = new Map<
    string,
    { x: number; y: number; z: number; angle: number; scale: number; pileCount?: number }
  >();
  const opponentHand = cards.filter((c) => c.side === "opponentHand");
  opponentHand.forEach((card, i) => {
    const x =
      (i - (opponentHand.length - 1) / 2) * Math.min(1.05, 8 / Math.max(opponentHand.length, 1));
    positions.set(card.id, {
      x,
      y: 0.4 + i * 0.025,
      z: -7.1 - Math.abs(x) * 0.04,
      angle: Math.PI + x * 0.035,
      scale: 0.78,
    });
  });
  for (const side of ["self", "opponent", "hand"] as const) {
    const sideCards = cards.filter((c) => c.side === side);
    for (const land of side === "hand" ? [false] : [false, true]) {
      const row = sideCards.filter((c) => side === "hand" || /land/i.test(c.type) === land);
      if (land && side !== "hand") {
        const groups: ArenaCard[][] = [];
        const matching = new Map<string, ArenaCard[][]>();
        for (const card of row) {
          // Creatures, hidden cards and cards involved in a decision stay separate.
          if (/creature/i.test(card.type) || card.hidden || card.selected || card.attacking) {
            groups.push([card]);
            continue;
          }
          const key = JSON.stringify([
            card.name,
            card.type,
            card.text,
            card.frame,
            !!card.tapped,
            card.stats,
          ]);
          let batches = matching.get(key);
          if (!batches) {
            batches = [];
            matching.set(key, batches);
          }
          let pile = batches.at(-1);
          if (!pile || pile.length === 4) {
            pile = [];
            batches.push(pile);
            groups.push(pile);
          }
          pile.push(card);
        }
        const columns = Math.min(6, groups.length);
        const scale = groups.length > 6 ? 0.82 : 1;
        groups.forEach((pile, index) =>
          pile.forEach((card, depth) => {
            const sign = side === "self" ? 1 : -1;
            positions.set(card.id, {
              x: ((index % 6) - (columns - 1) / 2) * 2.9 + (depth - (pile.length - 1) / 2) * 0.24,
              y: -0.12 + depth * 0.045,
              z:
                sign *
                ((side === "opponent" ? 8.8 : 5.5) + Math.floor(index / 6) * 2.2 + depth * 0.16),
              angle: card.tapped ? -0.14 : 0,
              scale,
              pileCount: depth === pile.length - 1 && pile.length > 1 ? pile.length : undefined,
            });
          }),
        );
        continue;
      }
      const columns = side === "hand" ? row.length : Math.min(9, row.length);
      const scale = row.length > 9 ? 0.72 : 1;
      row.forEach((card, i) => {
        const index = side === "hand" ? i : i % 9;
        const x =
          (index - (columns - 1) / 2) *
          Math.min(
            side === "hand" ? 1.5 : 2.65,
            (side === "hand" ? 10 : 18) / Math.max(columns, 1),
          );
        const depth = Math.floor(i / 9) * 1.05;
        const sign = side === "opponent" ? -1 : 1;
        positions.set(card.id, {
          x,
          y: side === "hand" ? 0.65 + i * 0.028 : -0.15 + i * 0.024,
          z:
            side === "hand"
              ? 6.5 + Math.abs(x) * 0.05
              : sign * ((side === "opponent" ? 4.6 : 2.1) + depth - (card.attacking ? 1.1 : 0)),
          angle: card.tapped ? -0.14 : side === "hand" ? -x * 0.045 : 0,
          scale,
        });
      });
    }
  }
  return positions;
}
