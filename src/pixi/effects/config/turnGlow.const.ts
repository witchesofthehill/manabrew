/**
 * Active-player felt-edge rim ("it's this player's turn"). Static, restrained —
 * not a breathing pulse. Color is theme-driven (`activeAction.active`); only the
 * geometry/intensity is tunable here.
 */
export const TURN_GLOW = {
  /** Concentric stroke layers (more = softer falloff). */
  layers: 3,
  /** Inset between layers, in px. */
  insetStep: 3,
  strokeWidth: 2,
  /** Alpha of the innermost layer (outer layers fade toward 0). */
  maxAlpha: 0.32,
} as const;
