import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { MANA_LETTERS } from "@/themes/gameTheme";
import type { DraftCard } from "@/types/limited";
import type { ScryfallCard } from "@/types/scryfall";

export type LimitedGrouping = "none" | "color" | "cmc" | "type" | "rarity";
export const LIMITED_GAP = 16;
export const LIMITED_PADDING = 16;
export const LIMITED_GROUP_HEADER = 32;
export const LIMITED_DRAG_THRESHOLD = 8;
export const LIMITED_MIN_CARD_WIDTH = 60;
export interface LimitedLayoutOptions {
  presentation?: "grid" | "spread" | "columns";
  height?: number;
}
export interface LimitedCell {
  card: DraftCard;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LimitedLayout {
  cells: LimitedCell[];
  headers: { label: string; x: number; y: number }[];
  height: number;
  columns: number;
}

function groupLabel(info: ScryfallCard | null, groupBy: LimitedGrouping): string {
  if (groupBy === "none") return "";
  if (!info) return "Loading card details";
  if (groupBy === "cmc") return `${info.cmc} mana`;
  if (groupBy === "rarity") return info.rarity.charAt(0).toUpperCase() + info.rarity.slice(1);
  if (groupBy === "type") return (info.type_line.split(" — ")[0] ?? info.type_line).trim();
  const colors = info.colors ?? info.color_identity;
  if (!colors.length) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  const names: Record<string, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
    C: "Colorless",
  };
  return names[colors[0]] ?? "Colorless";
}

function spreadLayout(
  cards: DraftCard[],
  width: number,
  size: number,
  height: number,
): LimitedLayout {
  const availableWidth = Math.max(0, width - LIMITED_PADDING * 2);
  const availableHeight = Math.max(0, height - LIMITED_PADDING * 2);
  const aspect = GAME_CARD_SIZES.hand.height / GAME_CARD_SIZES.hand.width;
  let cardWidth = 0;
  let columns = 1;
  for (let rows = 1; rows <= cards.length; rows++) {
    const candidateColumns = Math.ceil(cards.length / rows);
    const candidateWidth = Math.min(
      size,
      (availableWidth - LIMITED_GAP * (candidateColumns - 1)) / candidateColumns,
      (availableHeight - LIMITED_GAP * (rows - 1)) / rows / aspect,
    );
    if (candidateWidth >= LIMITED_MIN_CARD_WIDTH && candidateWidth > cardWidth) {
      cardWidth = candidateWidth;
      columns = candidateColumns;
    }
  }
  if (!cardWidth) {
    cardWidth = Math.min(
      Math.max(LIMITED_MIN_CARD_WIDTH, size),
      Math.max(LIMITED_MIN_CARD_WIDTH, availableWidth),
    );
    columns = Math.max(1, Math.floor((availableWidth + LIMITED_GAP) / (cardWidth + LIMITED_GAP)));
  }
  const cardHeight = cardWidth * aspect;
  const rows = Math.ceil(cards.length / columns);
  const contentHeight = rows ? rows * cardHeight + (rows - 1) * LIMITED_GAP : 0;
  const top = Math.max(LIMITED_PADDING, (height - contentHeight) / 2);
  const cells = cards.map((card, index) => {
    const row = Math.floor(index / columns);
    const rowCount = Math.min(columns, cards.length - row * columns);
    const rowWidth = rowCount * cardWidth + (rowCount - 1) * LIMITED_GAP;
    return {
      card,
      x:
        Math.max(LIMITED_PADDING, (width - rowWidth) / 2) +
        (index % columns) * (cardWidth + LIMITED_GAP),
      y: top + row * (cardHeight + LIMITED_GAP),
      width: cardWidth,
      height: cardHeight,
    };
  });
  return {
    cells,
    headers: [],
    height: Math.max(height, top + contentHeight + LIMITED_PADDING),
    columns,
  };
}

function columnLayout(
  groups: Map<string, DraftCard[]>,
  labels: string[],
  width: number,
  cardWidth: number,
  cardHeight: number,
  columns: number,
): LimitedLayout {
  const cells: LimitedCell[] = [];
  const headers: LimitedLayout["headers"] = [];
  const lanes = Math.min(labels.length, columns);
  if (!lanes) return { cells, headers, height: LIMITED_PADDING * 2, columns };
  const laneWidth = (width - LIMITED_PADDING * 2 - (lanes - 1) * LIMITED_GAP) / lanes;
  const laneColumns = Math.max(
    1,
    Math.floor((laneWidth + LIMITED_GAP) / (cardWidth + LIMITED_GAP)),
  );
  let y = LIMITED_PADDING;
  for (let start = 0; start < labels.length; start += lanes) {
    let bandHeight = 0;
    for (let lane = 0; lane < lanes && start + lane < labels.length; lane++) {
      const label = labels[start + lane];
      const cards = groups.get(label)!;
      const x = LIMITED_PADDING + lane * (laneWidth + LIMITED_GAP);
      headers.push({ label: `${label} · ${cards.length}`, x, y });
      cards.forEach((card, index) =>
        cells.push({
          card,
          x: x + (index % laneColumns) * (cardWidth + LIMITED_GAP),
          y:
            y + LIMITED_GROUP_HEADER + Math.floor(index / laneColumns) * (cardHeight + LIMITED_GAP),
          width: cardWidth,
          height: cardHeight,
        }),
      );
      bandHeight = Math.max(
        bandHeight,
        LIMITED_GROUP_HEADER + Math.ceil(cards.length / laneColumns) * (cardHeight + LIMITED_GAP),
      );
    }
    y += bandHeight;
  }
  return { cells, headers, height: Math.max(y, LIMITED_PADDING * 2), columns };
}

export function limitedLayout(
  cards: DraftCard[],
  width: number,
  size: number,
  groupBy: LimitedGrouping,
  metadata: (card: DraftCard) => ScryfallCard | null,
  options: LimitedLayoutOptions = {},
): LimitedLayout {
  if (options.presentation === "spread" && groupBy === "none")
    return spreadLayout(cards, width, size, options.height ?? 0);
  const cardWidth = Math.min(
    Math.max(LIMITED_MIN_CARD_WIDTH, size),
    Math.max(LIMITED_MIN_CARD_WIDTH, width - LIMITED_PADDING * 2),
  );
  const cardHeight = (cardWidth * GAME_CARD_SIZES.hand.height) / GAME_CARD_SIZES.hand.width;
  const columns = Math.max(
    1,
    Math.floor((width - LIMITED_PADDING * 2 + LIMITED_GAP) / (cardWidth + LIMITED_GAP)),
  );
  const groups = new Map<string, DraftCard[]>();
  for (const card of cards) {
    const label = groupLabel(metadata(card), groupBy);
    const group = groups.get(label) ?? [];
    group.push(card);
    groups.set(label, group);
  }
  const colorOrder = [
    ...MANA_LETTERS.map(
      (letter) =>
        ({ W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" })[letter],
    ),
    "Multicolor",
    "Loading card details",
  ];
  const labels = [...groups.keys()];
  if (groupBy === "color") labels.sort((a, b) => colorOrder.indexOf(a) - colorOrder.indexOf(b));
  if (groupBy === "cmc") labels.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
  if (groupBy === "type" || groupBy === "rarity") labels.sort((a, b) => a.localeCompare(b));
  if (options.presentation === "columns" && groupBy !== "none")
    return columnLayout(groups, labels, width, cardWidth, cardHeight, columns);
  const cells: LimitedCell[] = [];
  const headers: LimitedLayout["headers"] = [];
  let y = LIMITED_PADDING;
  for (const label of labels) {
    const group = groups.get(label)!;
    if (label) {
      headers.push({ label: `${label} · ${group.length}`, x: LIMITED_PADDING, y });
      y += LIMITED_GROUP_HEADER;
    }
    group.forEach((card, index) =>
      cells.push({
        card,
        x: LIMITED_PADDING + (index % columns) * (cardWidth + LIMITED_GAP),
        y: y + Math.floor(index / columns) * (cardHeight + LIMITED_GAP),
        width: cardWidth,
        height: cardHeight,
      }),
    );
    y += Math.ceil(group.length / columns) * (cardHeight + LIMITED_GAP);
  }
  return { cells, headers, height: Math.max(y, LIMITED_PADDING * 2), columns };
}
