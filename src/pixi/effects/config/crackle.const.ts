// `color` is a fixed aesthetic, not a theme token; lifetimes are in animation frames (~60/s).
export const CRACKLE = {
  color: 0xc7a35a,
  armsMin: 5,
  armsExtra: 4,
  lengthMin: 15,
  lengthExtra: 30,
  segments: 4,
  baseJitter: 0.5,
  segmentJitter: 0.6,
  flatten: 0.5,
  strokeWidth: 1.1,
  strokeAlpha: 0.95,
  blotchRadiusX: 5,
  blotchRadiusY: 2.5,
  blotchAlpha: 0.4,
  lifeFrames: 22,
  holdFraction: 0.08,
} as const;
