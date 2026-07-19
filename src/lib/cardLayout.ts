const HORIZONTAL_LAYOUTS = new Set(["split", "aftermath", "battle", "room", "planar", "scheme"]);

const SIDEWAYS_FRAME_LAYOUTS = new Set(["saga"]);

const TWO_HALF_LAYOUTS = new Set(["split", "aftermath", "room"]);

const TWO_FACE_LAYOUTS = new Set([
  "transform",
  "modal_dfc",
  "battle",
  "meld",
  "double_faced_token",
  "reversible_card",
]);

export function isHorizontalLayout(layout: string | undefined): boolean {
  return !!layout && HORIZONTAL_LAYOUTS.has(layout);
}

const HORIZONTAL_TYPES = new Set(["Battle", "Plane", "Phenomenon", "Scheme"]);

// Type-line fallback: some battle/plane/scheme printings ship with
// `layout: "transform"` (back-face driven), so layout alone misses them.
export function isHorizontalCard(opts: {
  layout?: string;
  types?: string[];
  typeLine?: string;
}): boolean {
  if (isHorizontalLayout(opts.layout)) return true;
  if (opts.types?.some((t) => HORIZONTAL_TYPES.has(t))) return true;
  const typeWords = new Set((opts.typeLine ?? "").split(/[^A-Za-z]+/));
  return [...HORIZONTAL_TYPES].some((t) => typeWords.has(t));
}

export function isSidewaysArtLayout(layout: string | undefined): boolean {
  return !!layout && SIDEWAYS_FRAME_LAYOUTS.has(layout);
}

export function isTwoHalfLayout(layout: string | undefined): boolean {
  return !!layout && TWO_HALF_LAYOUTS.has(layout);
}

export function isTwoFaceLayout(layout: string | undefined): boolean {
  return !!layout && TWO_FACE_LAYOUTS.has(layout);
}

export function aspectRatioForLayout(layout: string | undefined): number {
  return isHorizontalLayout(layout) ? 7 / 5 : 5 / 7;
}
