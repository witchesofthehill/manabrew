/**
 * Color-matrix treatment for summoning-sick (greyscale + dimmed) and phased-out
 * (greyscale) cards. Mirrors the DOM card face. `saturate(-1)` is full
 * black-and-white (the matrix averages RGB to luminance); values past -1 invert
 * channels rather than desaturating further. `brightness` < 1 dims.
 */
export const SUMMONING_FILTER = {
  sickSaturate: -1,
  sickBrightness: 0.78,
  phasedSaturate: -1,
} as const;

export const IGNORED_CARD = {
  saturate: -0.9,
  brightness: 0.6,
} as const;
