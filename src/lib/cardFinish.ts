import type {
  CardBorderPreset,
  CardCosmetics,
  CardFinish,
  CardFramePreset,
  CardWearPreset,
} from "@/protocol/deck";

export const CARD_FINISH_PRESETS = [
  { id: "regular", label: "Regular" },
  { id: "gloss", label: "Gloss" },
  { id: "etched", label: "Etched" },
  { id: "prismatic", label: "Prismatic" },
  { id: "holofoil", label: "Holofoil" },
  { id: "cold", label: "Cold silver" },
  { id: "opal", label: "Opal" },
  { id: "rain", label: "Rain" },
  { id: "heat", label: "Heat" },
  { id: "pool", label: "Pool" },
] as const satisfies readonly { id: CardFinish; label: string }[];

export const CARD_FRAME_PRESETS = [
  { id: "printing", label: "Selected printing" },
  { id: "modern", label: "Modern" },
  { id: "retro", label: "Retro" },
] as const satisfies readonly { id: CardFramePreset; label: string }[];

export const CARD_BORDER_PRESETS = [
  { id: "printing", label: "Selected printing" },
  { id: "black", label: "Black" },
  { id: "white", label: "White" },
  { id: "silver", label: "Silver" },
] as const satisfies readonly { id: CardBorderPreset; label: string }[];

export const CARD_WEAR_PRESETS = [
  { id: "fresh", label: "Fresh" },
  { id: "light", label: "Light" },
  { id: "played", label: "Played" },
  { id: "heavy", label: "Heavy" },
] as const satisfies readonly { id: CardWearPreset; label: string }[];

export const DEFAULT_CARD_FINISH: CardFinish = "prismatic";
export const CARD_WEAR_AMOUNTS: Record<CardWearPreset, number> = {
  fresh: 0,
  light: 0.25,
  played: 0.6,
  heavy: 1,
};

export function resolveCardFinish(
  foil: boolean,
  cosmetics?: CardCosmetics,
  etched = false,
): CardFinish {
  return cosmetics?.finish ?? (foil ? (etched ? "etched" : DEFAULT_CARD_FINISH) : "regular");
}

export function resolveCardWearAmount(cosmetics?: CardCosmetics): number {
  const amount = cosmetics?.wearAmount;
  return typeof amount === "number" && Number.isFinite(amount)
    ? Math.max(0, Math.min(1, amount))
    : CARD_WEAR_AMOUNTS[cosmetics?.wear ?? "fresh"];
}

export function resolveCardRainFog(cosmetics?: CardCosmetics): number {
  const density = cosmetics?.rainFog;
  return typeof density === "number" && Number.isFinite(density)
    ? Math.max(0, Math.min(2, density))
    : 1;
}

export function isEtchedOnlyPrinting(finishes?: readonly string[]): boolean {
  return !!finishes?.includes("etched") && !finishes.includes("foil");
}

export interface CardFoilRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CARD_FINISH_KINDS: Record<CardFinish, number> = {
  regular: 0,
  etched: 1,
  prismatic: 2,
  cold: 3,
  opal: 4,
  rain: 5,
  heat: 6,
  pool: 7,
  gloss: 8,
  holofoil: 9,
};
