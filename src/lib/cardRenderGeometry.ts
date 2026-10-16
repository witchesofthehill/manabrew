import {
  faceRects,
  isSemanticLayout,
  semanticLayoutRegions,
  faceFrame,
  extraRuleBlocks,
  splitPanels,
  panelRect,
  ADVENTURE_RULE_BOUNDS,
  PREPARE_SPELL_RECTS,
  FLIP_PANEL_RECTS,
  STANDARD_TEMPLATE_DEFAULTS,
  FACE_WIDTH,
  FACE_HEIGHT,
  rulesFont,
  resolveCardProfile,
  resolveFrameColors,
  type RenderedCardInput,
  type FaceRect,
} from "card-glint/magic/presentation";
import type { CardCanvas } from "@/lib/cardRenderTypes";

export const CARD_RENDER_WIDTH = 375;
export const CARD_RENDER_HEIGHT = 525;
const RULES_FONT_FAMILY = rulesFont(1).replace(/^1px\s+/, "");

export interface CardRenderRegion {
  readonly name: string;
  readonly role: "rules" | "stats" | "artwork" | "title" | "type";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
  readonly inkTone?: "dark" | "light";
  readonly fontFamily?: string;
}

export interface CardArtWindow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
const artWindowsByCanvas = new WeakMap<CardCanvas, readonly CardArtWindow[]>();
const NO_ART_WINDOWS: readonly CardArtWindow[] = Object.freeze([]);
export function getCardArtWindows(canvas: CardCanvas): readonly CardArtWindow[] {
  return artWindowsByCanvas.get(canvas) ?? NO_ART_WINDOWS;
}

export interface CardInteractionRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly source: "native" | "conservative";
}

export interface CardRenderGeometry {
  readonly width: number;
  readonly height: number;
  readonly sourceOrientation: "portrait" | "landscape";
  readonly normalizationRotation: 0 | -90;
  readonly regions: readonly CardRenderRegion[];
  readonly rules: readonly CardRenderRegion[];
  readonly artwork: readonly CardRenderRegion[];
  readonly title: readonly CardRenderRegion[];
  readonly stats: readonly CardRenderRegion[];
  readonly interaction: {
    readonly portrait: CardInteractionRegion;
    readonly landscape: CardInteractionRegion;
  };
}

const geometryByCanvas = new WeakMap<CardCanvas, CardRenderGeometry>();
const FALLBACK_INTERACTION = Object.freeze({
  portrait: Object.freeze({
    x: 25,
    y: 340,
    width: 325,
    height: 160,
    source: "conservative" as const,
  }),
  landscape: Object.freeze({
    x: 275,
    y: 77,
    width: 223,
    height: 260,
    source: "conservative" as const,
  }),
});
const REGION_ALIGNMENT_TOLERANCE = 16;
const REGION_WIDTH_TOLERANCE = 32;
const REGION_GAP_TOLERANCE = 24;

export function orientCardRegion(region: CardRenderRegion, landscape: boolean): CardRenderRegion {
  return landscape
    ? {
        ...region,
        x: CARD_RENDER_HEIGHT - region.y - region.height,
        y: region.x,
        width: region.height,
        height: region.width,
        angle: (region.angle + 90) % 360,
      }
    : region;
}

function interactionRegion(
  rules: readonly CardRenderRegion[],
  stats: readonly CardRenderRegion[],
  landscape: boolean,
): CardInteractionRegion {
  const groups: { x: number; y: number; width: number; height: number }[] = [];
  const regions = rules
    .map((region) => orientCardRegion(region, landscape))
    .sort((a, b) => a.y - b.y);
  for (const region of regions) {
    const group = groups.find(
      (candidate) =>
        Math.abs(candidate.x - region.x) < REGION_ALIGNMENT_TOLERANCE &&
        Math.abs(candidate.width - region.width) < REGION_WIDTH_TOLERANCE &&
        region.y <= candidate.y + candidate.height + REGION_GAP_TOLERANCE,
    );
    if (group) {
      const right = Math.max(group.x + group.width, region.x + region.width);
      const bottom = Math.max(group.y + group.height, region.y + region.height);
      group.x = Math.min(group.x, region.x);
      group.y = Math.min(group.y, region.y);
      group.width = right - group.x;
      group.height = bottom - group.y;
    } else groups.push({ x: region.x, y: region.y, width: region.width, height: region.height });
  }
  for (const group of groups) {
    for (const field of stats) {
      const stat = orientCardRegion(field, landscape);
      if (
        stat.x < group.x + group.width &&
        stat.x + stat.width > group.x &&
        stat.y > group.y &&
        stat.y < group.y + group.height
      ) {
        group.height = stat.y - group.y;
      }
    }
  }
  const largest = groups.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return largest
    ? Object.freeze({ ...largest, source: "native" })
    : Object.freeze({ x: 0, y: 0, width: 0, height: 0, source: "native" });
}

export function attachCardRenderGeometry(canvas: CardCanvas, face: RenderedCardInput): void {
  const panels = splitPanels(face);
  const regions: CardRenderRegion[] = [];
  const leveler = faceFrame(face) === "leveler";
  const palette = resolveFrameColors(face);
  const inkTone =
    face.frameTemplate === "future" &&
    resolveCardProfile(face).land &&
    palette.length === 2 &&
    !palette.includes("W")
      ? "light"
      : "dark";
  const add = (name: string, role: CardRenderRegion["role"], rect: FaceRect, angle: number) => {
    const [x, y, width, height] = rect;
    regions.push(
      Object.freeze({
        name,
        role,
        x: x * CARD_RENDER_WIDTH,
        y: y * CARD_RENDER_HEIGHT,
        width: width * CARD_RENDER_WIDTH,
        height: height * CARD_RENDER_HEIGHT,
        angle,
        ...(role === "rules" ? { inkTone, fontFamily: RULES_FONT_FAMILY } : {}),
      }),
    );
  };
  const append = (
    part: RenderedCardInput,
    index: number,
    transform: (rect: FaceRect) => FaceRect,
    angle: number,
  ) => {
    const rects = faceRects(part);
    for (const [key, role] of [
      ["rules", "rules"],
      ["stats", "stats"],
      ["art", "artwork"],
      ["title", "title"],
      ["type", "type"],
    ] as const) {
      if (face.frameTemplate === "flip" && key !== "art") continue;
      if (key === "rules" && face.layout === "adventure") continue;
      if (leveler && (key === "rules" || key === "stats")) continue;
      if (key === "stats" && part.power == null && part.loyalty == null && part.defense == null)
        continue;
      add(`${key}_${index}`, role, transform(rects[key]), angle);
    }
  };
  if (isSemanticLayout(face))
    semanticLayoutRegions(face).forEach((region) =>
      add(region.name, region.role, region.rect, region.angle),
    );
  else if (panels.length)
    panels.forEach((panel, index) =>
      append(panel.face, index, (rect) => panelRect(panel, rect), (panel.rotation + 360) % 360),
    );
  else append(face, 0, (rect) => rect, face.frameTemplate === "battle" ? 270 : 0);
  if (face.frameTemplate === "flip") {
    const [width, height] = STANDARD_TEMPLATE_DEFAULTS.flip.size;
    FLIP_PANEL_RECTS.forEach((rects, index) => {
      for (const key of ["rules", "stats", "title", "type"] as const) {
        if (key === "stats" && face.faces?.[index]?.power == null) continue;
        const [x, y, w, h] = rects[key];
        add(
          `${key}_${index}`,
          key,
          index === 0
            ? [x / width, y / height, w / width, h / height]
            : [1 - (x + w) / width, 1 - (y + h) / height, w / width, h / height],
          index * 180,
        );
      }
    });
  }
  if (face.layout === "adventure") {
    Object.values(ADVENTURE_RULE_BOUNDS).forEach(({ x, y, width, height }, index) =>
      add(
        `rules_${index}`,
        "rules",
        [x / FACE_WIDTH, y / FACE_HEIGHT, width / FACE_WIDTH, height / FACE_HEIGHT],
        0,
      ),
    );
  }
  if (face.layout === "prepare") {
    for (const key of ["rules", "title", "type"] as const)
      add(`${key}_1`, key, PREPARE_SPELL_RECTS[key], 0);
  }
  if (leveler) {
    extraRuleBlocks(face).forEach((block, index) => {
      if (block.kind !== "rules" && block.kind !== "stats") return;
      add(
        `${block.kind}_${index}`,
        block.kind,
        [
          block.x / FACE_WIDTH,
          block.y / FACE_HEIGHT,
          block.width / FACE_WIDTH,
          block.height / FACE_HEIGHT,
        ],
        0,
      );
    });
  }
  const rules = Object.freeze(regions.filter((region) => region.role === "rules"));
  const stats = Object.freeze(regions.filter((region) => region.role === "stats"));
  const artwork = Object.freeze(regions.filter((region) => region.role === "artwork"));
  artWindowsByCanvas.set(
    canvas,
    Object.freeze(
      artwork.map((region) =>
        Object.freeze({
          x: region.x / CARD_RENDER_WIDTH,
          y: region.y / CARD_RENDER_HEIGHT,
          width: region.width / CARD_RENDER_WIDTH,
          height: region.height / CARD_RENDER_HEIGHT,
        }),
      ),
    ),
  );
  geometryByCanvas.set(
    canvas,
    Object.freeze({
      width: CARD_RENDER_WIDTH,
      height: CARD_RENDER_HEIGHT,
      sourceOrientation:
        face.frameTemplate === "battle" || face.layout === "room" || face.layout === "planar"
          ? "landscape"
          : "portrait",
      normalizationRotation:
        face.frameTemplate === "battle" || face.layout === "room" || face.layout === "planar"
          ? -90
          : 0,
      regions: Object.freeze(regions),
      rules,
      artwork,
      title: Object.freeze(regions.filter((region) => region.role === "title")),
      stats,
      interaction: Object.freeze({
        portrait: interactionRegion(rules, stats, false),
        landscape: interactionRegion(rules, stats, true),
      }),
    }),
  );
}

export function getCardRenderGeometry(canvas: CardCanvas): CardRenderGeometry | undefined {
  return geometryByCanvas.get(canvas);
}

export function getCardInteractionRegion(
  geometry: CardRenderGeometry | undefined,
  landscape: boolean,
  includeStats = false,
): CardInteractionRegion {
  const orientation = landscape ? "landscape" : "portrait";
  const region = geometry?.interaction[orientation] ?? FALLBACK_INTERACTION[orientation];
  if (!includeStats || !geometry || region.width <= 0 || region.height <= 0) return region;
  let left = region.x;
  let right = region.x + region.width;
  let bottom = region.y + region.height;
  for (const field of geometry.stats) {
    const stat = orientCardRegion(field, landscape);
    if (
      stat.x >= region.x + region.width ||
      stat.x + stat.width <= region.x ||
      stat.y < region.y ||
      stat.y > region.y + region.height + REGION_GAP_TOLERANCE
    ) {
      continue;
    }
    left = Math.min(left, stat.x);
    right = Math.max(right, stat.x + stat.width);
    bottom = Math.max(bottom, stat.y + stat.height);
  }
  return {
    x: left,
    y: region.y,
    width: right - left,
    height: bottom - region.y,
    source: region.source,
  };
}
