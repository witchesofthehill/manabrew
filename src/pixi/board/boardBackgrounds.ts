import darkOak from "@/assets/boards/dark_oak.webp";
import darkStone from "@/assets/boards/dark_stone.webp";
import darkTable from "@/assets/boards/dark_table.webp";
import darkWood from "@/assets/boards/dark_wood.webp";
import glacier from "@/assets/boards/glacier.webp";
import magicCloth from "@/assets/boards/magic_cloth.webp";
import refinedRedwood from "@/assets/boards/refined_redwood.webp";
import refinedStone from "@/assets/boards/refined_stone.webp";
import refinedWood from "@/assets/boards/refined_wood.webp";
import stoneSlate from "@/assets/boards/stone_slate.webp";
import tavernTable from "@/assets/boards/tavern_table.webp";
import volcanicStone from "@/assets/boards/volcanic_stone.webp";

export type BoardBackgroundId =
  | "none"
  | "dark_oak"
  | "dark_stone"
  | "dark_table"
  | "dark_wood"
  | "glacier"
  | "magic_cloth"
  | "refined_redwood"
  | "refined_stone"
  | "refined_wood"
  | "stone_slate"
  | "tavern_table"
  | "volcanic_stone";

export interface BoardBackgroundOption {
  id: BoardBackgroundId;
  label: string;
  url: string | null;
  darken: number;
}

export const BOARD_BACKGROUNDS: readonly BoardBackgroundOption[] = [
  { id: "none", label: "None", url: null, darken: 0 },
  { id: "dark_oak", label: "Dark oak", url: darkOak, darken: 0 },
  { id: "dark_stone", label: "Dark stone", url: darkStone, darken: 0 },
  { id: "dark_table", label: "Dark table", url: darkTable, darken: 0 },
  { id: "dark_wood", label: "Dark wood", url: darkWood, darken: 0 },
  { id: "glacier", label: "Glacier", url: glacier, darken: 0 },
  { id: "magic_cloth", label: "Magic cloth", url: magicCloth, darken: 0 },
  { id: "refined_redwood", label: "Refined redwood", url: refinedRedwood, darken: 0 },
  { id: "refined_stone", label: "Refined stone", url: refinedStone, darken: 0 },
  { id: "refined_wood", label: "Refined wood", url: refinedWood, darken: 0 },
  { id: "stone_slate", label: "Stone slate", url: stoneSlate, darken: 0 },
  { id: "tavern_table", label: "Tavern table", url: tavernTable, darken: 0.3 },
  { id: "volcanic_stone", label: "Volcanic stone", url: volcanicStone, darken: 0 },
];

export const DEFAULT_BOARD_BACKGROUND_ID: BoardBackgroundId = "dark_stone";

function boardBackgroundOption(id: string | null | undefined): BoardBackgroundOption {
  return (
    BOARD_BACKGROUNDS.find((o) => o.id === id) ??
    BOARD_BACKGROUNDS.find((o) => o.id === DEFAULT_BOARD_BACKGROUND_ID)!
  );
}

export function boardBackgroundUrl(id: string | null | undefined): string | null {
  return boardBackgroundOption(id).url;
}

export function boardBackgroundDarken(id: string | null | undefined): number {
  return boardBackgroundOption(id).darken;
}

const ambientColorCache = new Map<string, number | null>();

export async function boardAmbientColor(url: string | null): Promise<number | null> {
  if (!url) return null;
  const cached = ambientColorCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, 8, 8);
    const { data } = ctx.getImageData(0, 0, 8, 8);
    let r = 0;
    let g = 0;
    let b = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    const color =
      (Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count);
    ambientColorCache.set(url, color);
    return color;
  } catch {
    ambientColorCache.set(url, null);
    return null;
  }
}
