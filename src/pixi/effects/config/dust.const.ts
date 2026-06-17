// `color` is a fixed aesthetic, not a theme token; lifetimes are in animation frames (~60/s).
export const DUST = {
  color: 0xd9c8a0,
  count: 34,
  speedMin: 0.4,
  speedExtra: 2.6,
  scaleMin: 0.2,
  scaleExtra: 0.55,
  upwardMin: 0.4,
  upwardExtra: 0.9,
  flatten: 0.55,
  gravity: 0.04,
  dragX: 0.88,
  dragY: 0.9,
  alpha: 0.45,
  lifeMin: 26,
  lifeExtra: 20,
  growth: 2.8,
} as const;
