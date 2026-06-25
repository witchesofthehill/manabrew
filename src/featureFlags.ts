/**
 * Single source of truth for compile-time feature flags. Add a boolean here
 * (default `false` to ship a feature dark) and read it via `isFeatureEnabled`.
 * Do not scatter feature gates anywhere else.
 */
export const featureFlags = {
  /** Tint each multiplayer battleground's full computed rectangle in the player's
   *  colour, to inspect the staggered field layout (overlap shows as mixed
   *  colours). Debug aid only — does not affect play. */
  debugBattlegroundRects: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
