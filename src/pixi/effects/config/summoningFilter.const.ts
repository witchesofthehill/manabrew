/**
 * Color-matrix treatment for summoning-sick (desaturated + dimmed) and
 * phased-out (desaturated) cards. Mirrors the DOM card face. Negative `saturate`
 * pushes toward greyscale; `brightness` < 1 dims.
 */
export const SUMMONING_FILTER = {
  sickSaturate: -1.3,
  sickBrightness: 0.78,
  phasedSaturate: -1.5,
} as const;
