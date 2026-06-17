/**
 * Per-card edge glow: red for attackers, frosty + pulsing for summoning-sick
 * creatures. Colors are theme-driven (`pt.lethal` / `textOnTinted`); geometry,
 * intensity and the sick pulse are tunable here.
 */
export const EDGE_GLOW = {
  /** Concentric stroke layers (more = softer falloff). */
  layers: 6,
  /** Inset between layers, in px. */
  insetStep: 1.6,
  strokeWidth: 2.2,
  /** Innermost-layer alpha for each state (outer layers fade toward 0). */
  attackingMaxAlpha: 0.9,
  sickMaxAlpha: 0.7,
  /** Summoning-sick breathing pulse. */
  pulsePeriodMs: 1600,
  pulseMin: 0.5,
  pulseMax: 0.95,
  /** Flat alpha used when in-game animations are disabled (no pulse). */
  staticAlpha: 0.85,
} as const;
