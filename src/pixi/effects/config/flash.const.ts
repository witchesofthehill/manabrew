// `color` is a fixed aesthetic, not a theme token; lifeFrames is in animation frames (~60/s).
export const FLASH = {
  color: 0xfff2cf,
  startRadius: 8,
  endRadius: 34,
  alpha: 0.7,
  flatten: 0.6,
  lifeFrames: 12,
} as const;
