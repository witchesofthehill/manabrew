import type { MseCanvas, MseLayoutField, MseRenderResult } from "@mse-renderer";

export const MSE_CARD_WIDTH = 375;
export const MSE_CARD_HEIGHT = 525;

export type MseCardRegion = Readonly<MseLayoutField>;

export interface MseInteractionRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly source: "native" | "conservative";
}

export interface MseCardGeometry {
  readonly width: number;
  readonly height: number;
  readonly sourceOrientation: "portrait" | "landscape";
  readonly normalizationRotation: 0 | -90;
  readonly regions: readonly MseCardRegion[];
  readonly rules: readonly MseCardRegion[];
  readonly artwork: readonly MseCardRegion[];
  readonly title: readonly MseCardRegion[];
  readonly stats: readonly MseCardRegion[];
  readonly interaction: {
    readonly portrait: MseInteractionRegion;
    readonly landscape: MseInteractionRegion;
  };
}

const geometryByCanvas = new WeakMap<MseCanvas, MseCardGeometry>();
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

function normalizeRegion(
  field: MseLayoutField,
  width: number,
  height: number,
): MseCardRegion | null {
  const landscape = width > height;
  const radians = (field.angle * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  let left = MSE_CARD_WIDTH;
  let top = MSE_CARD_HEIGHT;
  let right = 0;
  let bottom = 0;
  for (const [dx, dy] of [
    [0, 0],
    [field.width, 0],
    [0, field.height],
    [field.width, field.height],
  ]) {
    const x = field.x + dx! * cosine - dy! * sine;
    const y = field.y + dx! * sine + dy! * cosine;
    const normalizedX = landscape ? y / height : x / width;
    const normalizedY = landscape ? 1 - x / width : y / height;
    left = Math.min(left, normalizedX * MSE_CARD_WIDTH);
    top = Math.min(top, normalizedY * MSE_CARD_HEIGHT);
    right = Math.max(right, normalizedX * MSE_CARD_WIDTH);
    bottom = Math.max(bottom, normalizedY * MSE_CARD_HEIGHT);
  }
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(MSE_CARD_WIDTH, right);
  bottom = Math.min(MSE_CARD_HEIGHT, bottom);
  if (right <= left || bottom <= top) return null;
  return Object.freeze({
    ...field,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    angle: (((field.angle - (landscape ? 90 : 0)) % 360) + 360) % 360,
  });
}

export function orientMseRegion(region: MseCardRegion, landscape: boolean): MseCardRegion {
  return landscape
    ? {
        ...region,
        x: MSE_CARD_HEIGHT - region.y - region.height,
        y: region.x,
        width: region.height,
        height: region.width,
        angle: (region.angle + 90) % 360,
      }
    : region;
}

function interactionRegion(
  rules: readonly MseCardRegion[],
  stats: readonly MseCardRegion[],
  landscape: boolean,
): MseInteractionRegion {
  const groups: { x: number; y: number; width: number; height: number }[] = [];
  const regions = rules
    .map((region) => orientMseRegion(region, landscape))
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
      const stat = orientMseRegion(field, landscape);
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
    : FALLBACK_INTERACTION[landscape ? "landscape" : "portrait"];
}

export function attachMseCardGeometry(canvas: MseCanvas, result: MseRenderResult): void {
  const regions = Object.freeze(
    result.layoutFields.flatMap((field) => {
      const region = normalizeRegion(field, result.width, result.height);
      return region ? [region] : [];
    }),
  );
  const rules = Object.freeze(regions.filter((region) => region.role === "rules"));
  const stats = Object.freeze(regions.filter((region) => region.role === "stats"));
  geometryByCanvas.set(
    canvas,
    Object.freeze({
      width: MSE_CARD_WIDTH,
      height: MSE_CARD_HEIGHT,
      sourceOrientation: result.width > result.height ? "landscape" : "portrait",
      normalizationRotation: result.width > result.height ? -90 : 0,
      regions,
      rules,
      artwork: Object.freeze(regions.filter((region) => region.role === "artwork")),
      title: Object.freeze(regions.filter((region) => region.role === "title")),
      stats,
      interaction: Object.freeze({
        portrait: interactionRegion(rules, stats, false),
        landscape: interactionRegion(rules, stats, true),
      }),
    }),
  );
}

export function getMseCardGeometry(canvas: MseCanvas): MseCardGeometry | undefined {
  return geometryByCanvas.get(canvas);
}

export function getMseInteractionRegion(
  geometry: MseCardGeometry | undefined,
  landscape: boolean,
): MseInteractionRegion {
  const orientation = landscape ? "landscape" : "portrait";
  return geometry?.interaction[orientation] ?? FALLBACK_INTERACTION[orientation];
}
