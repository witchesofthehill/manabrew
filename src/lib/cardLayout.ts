const HORIZONTAL_LAYOUTS: Record<string, true> = {
  split: true,
  aftermath: true,
  battle: true,
  room: true,
  planar: true,
};

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
  return !!layout && HORIZONTAL_LAYOUTS[layout] === true;
}

const HORIZONTAL_TYPES: Record<string, true> = {
  Battle: true,
  Plane: true,
  Phenomenon: true,
};

// Type-line fallback: some battle printings ship with
// `layout: "transform"` (back-face driven), so layout alone misses them.
export function isHorizontalCard(opts: {
  layout?: string;
  types?: string[];
  typeLine?: string;
}): boolean {
  if (isHorizontalLayout(opts.layout)) return true;
  if (opts.types?.some((type) => HORIZONTAL_TYPES[type] === true)) return true;
  return (opts.typeLine ?? "").split(/[^A-Za-z]+/).some((type) => HORIZONTAL_TYPES[type] === true);
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
