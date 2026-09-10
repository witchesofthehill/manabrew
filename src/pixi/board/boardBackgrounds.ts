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
}

export const BOARD_BACKGROUNDS: readonly BoardBackgroundOption[] = [
  { id: "none", label: "None", url: null },
  { id: "dark_oak", label: "Dark oak", url: darkOak },
  { id: "dark_stone", label: "Dark stone", url: darkStone },
  { id: "dark_table", label: "Dark table", url: darkTable },
  { id: "dark_wood", label: "Dark wood", url: darkWood },
  { id: "glacier", label: "Glacier", url: glacier },
  { id: "magic_cloth", label: "Magic cloth", url: magicCloth },
  { id: "refined_redwood", label: "Refined redwood", url: refinedRedwood },
  { id: "refined_stone", label: "Refined stone", url: refinedStone },
  { id: "refined_wood", label: "Refined wood", url: refinedWood },
  { id: "stone_slate", label: "Stone slate", url: stoneSlate },
  { id: "tavern_table", label: "Tavern table", url: tavernTable },
  { id: "volcanic_stone", label: "Volcanic stone", url: volcanicStone },
];

export const DEFAULT_BOARD_BACKGROUND_ID: BoardBackgroundId = "dark_stone";

export function boardBackgroundUrl(id: string | null | undefined): string | null {
  const option =
    BOARD_BACKGROUNDS.find((o) => o.id === id) ??
    BOARD_BACKGROUNDS.find((o) => o.id === DEFAULT_BOARD_BACKGROUND_ID)!;
  return option.url;
}
