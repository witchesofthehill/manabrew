import type { CompanionLayout } from "@/stores/useCompanionStore.types";

export interface CompanionSlot {
  gridArea: string;
  rotation: number;
}

interface LayoutSpec {
  template: string;
  slots: CompanionSlot[];
}

const LAYOUT_SPECS: Record<Exclude<CompanionLayout, "free">, LayoutSpec> = {
  "1v1": {
    template: `"top" 1fr "bottom" 1fr / 1fr`,
    slots: [
      { gridArea: "bottom", rotation: 0 },
      { gridArea: "top", rotation: 180 },
    ],
  },
  "two-side": {
    template: `"l r" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "l", rotation: 0 },
      { gridArea: "r", rotation: 0 },
    ],
  },
  "three-wedge": {
    template: `"top top" 1fr "bl br" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "bl", rotation: 0 },
      { gridArea: "br", rotation: 0 },
      { gridArea: "top", rotation: 180 },
    ],
  },
  quad: {
    template: `"tl tr" 1fr "bl br" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "bl", rotation: 0 },
      { gridArea: "br", rotation: 0 },
      { gridArea: "tl", rotation: 180 },
      { gridArea: "tr", rotation: 180 },
    ],
  },
  "five-radial": {
    template: `"top top" 1fr "ml mr" 1fr "bl br" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "bl", rotation: 0 },
      { gridArea: "br", rotation: 0 },
      { gridArea: "ml", rotation: 90 },
      { gridArea: "mr", rotation: -90 },
      { gridArea: "top", rotation: 180 },
    ],
  },
  "six-grid": {
    template: `"tl tm tr" 1fr "bl bm br" 1fr / 1fr 1fr 1fr`,
    slots: [
      { gridArea: "bl", rotation: 0 },
      { gridArea: "bm", rotation: 0 },
      { gridArea: "br", rotation: 0 },
      { gridArea: "tl", rotation: 180 },
      { gridArea: "tm", rotation: 180 },
      { gridArea: "tr", rotation: 180 },
    ],
  },
};

export function getCompanionSlots(
  layout: CompanionLayout,
  playerCount: number,
): {
  template: string;
  slots: CompanionSlot[];
} {
  if (layout === "free") {
    return { template: `"all" 1fr / 1fr`, slots: [] };
  }
  const spec = LAYOUT_SPECS[layout];
  return {
    template: spec.template,
    slots: spec.slots.slice(0, playerCount),
  };
}
