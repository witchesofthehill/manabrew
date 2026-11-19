export interface CardFoilAtlasItem {
  width: number;
  height: number;
}

export interface CardFoilAtlasPage<T> {
  width: number;
  height: number;
  placements: { item: T; x: number; y: number }[];
}

export function packCardFoilAtlas<T extends CardFoilAtlasItem>(
  items: readonly T[],
  edge: number,
  gap: number,
): CardFoilAtlasPage<T>[] {
  const pages: CardFoilAtlasPage<T>[] = [];
  let page: CardFoilAtlasPage<T> | null = null;
  let x = gap;
  let y = gap;
  let rowHeight = 0;
  for (const item of items) {
    if (item.width + gap * 2 > edge || item.height + gap * 2 > edge)
      throw new RangeError("Card foil output exceeds atlas page bounds");
    if (x + item.width + gap > edge) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    if (!page || y + item.height + gap > edge) {
      page = { width: 0, height: 0, placements: [] };
      pages.push(page);
      x = gap;
      y = gap;
      rowHeight = 0;
    }
    page.placements.push({ item, x, y });
    page.width = Math.max(page.width, x + item.width + gap);
    page.height = Math.max(page.height, y + item.height + gap);
    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
  }
  return pages;
}
