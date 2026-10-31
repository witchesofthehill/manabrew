import type { CardDto } from "@/protocol/game";
import { cellKey, type GridLayoutInfo } from "@/pixi/GridLayout";

export type BattlefieldCardCategory = "creature" | "other" | "land";

export function battlefieldCardCategory(card: CardDto): BattlefieldCardCategory {
  if (card.types.includes("Creature")) return "creature";
  if (card.types.includes("Land")) return "land";
  return "other";
}

export function semanticRowPlan(
  cards: readonly CardDto[],
  grid: GridLayoutInfo,
  occupied: ReadonlySet<string>,
  mirrored: boolean,
) {
  const demand = { creature: 0, other: 0, land: 0 };
  for (const card of cards) demand[battlefieldCardCategory(card)]++;
  const order: BattlefieldCardCategory[] = mirrored
    ? ["land", "other", "creature"]
    : ["creature", "other", "land"];
  const active = order.filter((category) => demand[category] > 0);
  const rowCapacity = Array.from({ length: grid.rows }, () => 0);
  for (const cell of grid.cells) {
    if (!cell.blocked && !occupied.has(cellKey(cell.col, cell.row))) rowCapacity[cell.row]!++;
  }
  const build = (counts: number[]) => {
    const rows: Record<BattlefieldCardCategory, number[]> = { creature: [], other: [], land: [] };
    let nextRow = 0;
    active.forEach((category, index) => {
      const count = counts[index]!;
      if (index === active.length - 1 && category === order[2]) {
        nextRow = Math.max(nextRow, grid.rows - count);
      } else if (category === "other") {
        const remaining = counts.slice(index + 1).reduce((sum, value) => sum + value, 0);
        nextRow += Math.max(0, Math.floor((grid.rows - nextRow - count - remaining) / 2));
      }
      rows[category] = Array.from({ length: count }, (_, offset) => nextRow + offset);
      nextRow += count;
    });
    const capacity = { creature: 0, other: 0, land: 0 };
    let deficit = 0;
    for (const category of active) {
      capacity[category] = rows[category].reduce((sum, row) => sum + (rowCapacity[row] ?? 0), 0);
      deficit += Math.max(0, demand[category] - capacity[category]);
    }
    return { rows, capacity, fits: deficit === 0, deficit };
  };
  let best = build(active.map(() => 1));
  const visit = (remaining: number, counts: number[]): void => {
    if (counts.length === active.length) {
      if (remaining !== 0) return;
      const candidate = build(counts);
      if (candidate.deficit < best.deficit) best = candidate;
      return;
    }
    const left = active.length - counts.length - 1;
    for (let count = 1; count <= remaining - left && !best.fits; count++) {
      visit(remaining - count, [...counts, count]);
    }
  };
  for (let used = active.length; used <= grid.rows && !best.fits; used++) visit(used, []);
  return best;
}
