import type { CompanionLayout } from "@/stores/useCompanionStore.types";

export interface CompanionSlot {
  gridArea: string;
  rotation: number;
}

interface LayoutSpec {
  template: string;
  slots: CompanionSlot[];
}

const LAYOUT_SPECS: Record<
  Exclude<CompanionLayout, "free" | "landscape-row" | "vertical-stack">,
  LayoutSpec
> = {
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
  "two-across": {
    template: `"l r" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "l", rotation: 90 },
      { gridArea: "r", rotation: -90 },
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
  "three-sides": {
    template: `"top top" 1fr "l r" 1.5fr / 1fr 1fr`,
    slots: [
      { gridArea: "top", rotation: 180 },
      { gridArea: "l", rotation: 90 },
      { gridArea: "r", rotation: -90 },
    ],
  },
  "pinwheel-3": {
    template: `"top top" 1.1fr "bl br" 0.9fr / 1fr 1fr`,
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
  "four-sides": {
    template: `"top top" 1fr "left right" 1.15fr "bottom bottom" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "bottom", rotation: 0 },
      { gridArea: "left", rotation: 90 },
      { gridArea: "top", rotation: 180 },
      { gridArea: "right", rotation: -90 },
    ],
  },
  "five-radial": {
    template: `"top top" 1fr "ml mr" 1fr "bl br" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "top", rotation: 180 },
      { gridArea: "ml", rotation: 90 },
      { gridArea: "mr", rotation: -90 },
      { gridArea: "bl", rotation: 90 },
      { gridArea: "br", rotation: -90 },
    ],
  },
  "five-rows": {
    template: `"t1 t1 t1 t2 t2 t2" 1fr "b1 b1 b2 b2 b3 b3" 1fr / 1fr 1fr 1fr 1fr 1fr 1fr`,
    slots: [
      { gridArea: "t1", rotation: 180 },
      { gridArea: "t2", rotation: 180 },
      { gridArea: "b1", rotation: 0 },
      { gridArea: "b2", rotation: 0 },
      { gridArea: "b3", rotation: 0 },
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
  "six-sides": {
    template: `"l1 r1" 1fr "l2 r2" 1fr "l3 r3" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "l1", rotation: 90 },
      { gridArea: "r1", rotation: -90 },
      { gridArea: "l2", rotation: 90 },
      { gridArea: "r2", rotation: -90 },
      { gridArea: "l3", rotation: 90 },
      { gridArea: "r3", rotation: -90 },
    ],
  },
  "pinwheel-6": {
    template: `"top1 top2" 1fr "ml mr" 1fr "bot1 bot2" 1fr / 1fr 1fr`,
    slots: [
      { gridArea: "bot1", rotation: 0 },
      { gridArea: "bot2", rotation: 0 },
      { gridArea: "ml", rotation: 90 },
      { gridArea: "mr", rotation: -90 },
      { gridArea: "top1", rotation: 180 },
      { gridArea: "top2", rotation: 180 },
    ],
  },
};

interface RowSpec {
  template: string;
  slot: (index: number, total: number) => CompanionSlot;
}

const LANDSCAPE_ROW: RowSpec = {
  template: "",
  slot: (index, _total) => ({ gridArea: `c${index}`, rotation: 0 }),
};

const VERTICAL_STACK: RowSpec = {
  template: "",
  slot: (index, total) => ({
    gridArea: `r${index}`,
    rotation: total >= 2 && index < Math.floor(total / 2) ? 180 : 0,
  }),
};

function landscapeRowTemplate(total: number): string {
  const areas = Array.from({ length: total }, (_, i) => `c${i}`).join(" ");
  const cols = Array.from({ length: total }, () => "1fr").join(" ");
  return `"${areas}" 1fr / ${cols}`;
}

function verticalStackTemplate(total: number): string {
  return Array.from({ length: total }, (_, i) => `"r${i}" 1fr`).join(" ") + " / 1fr";
}

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
  if (layout === "landscape-row") {
    return {
      template: landscapeRowTemplate(playerCount),
      slots: Array.from({ length: playerCount }, (_, i) => LANDSCAPE_ROW.slot(i, playerCount)),
    };
  }
  if (layout === "vertical-stack") {
    return {
      template: verticalStackTemplate(playerCount),
      slots: Array.from({ length: playerCount }, (_, i) => VERTICAL_STACK.slot(i, playerCount)),
    };
  }
  const spec = LAYOUT_SPECS[layout];
  return {
    template: spec.template,
    slots: spec.slots.slice(0, playerCount),
  };
}
