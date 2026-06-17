/**
 * Brief P/T badge "pop" when power/toughness changes (a buff/debuff cue).
 */
export const STAT_POP = {
  /** Pop duration in ms (rises then falls via `bump`). */
  durationMs: 360,
  /** Extra scale at the peak (badge reaches 1 + this). */
  bumpScale: 0.35,
} as const;
