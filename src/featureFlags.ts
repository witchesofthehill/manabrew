/**
 * Single source of truth for compile-time feature flags. Flip a value to
 * `true` to enable a feature; ship it `false` to keep it dark. Do not scatter
 * feature gates anywhere else — add the flag here and read it via
 * `isFeatureEnabled`.
 */
export const featureFlags = {
  /**
   * Wrap-around ("perimeter") 4-player battlefield layout: opponents seated on
   * the left/top/right with rotated side seats and a split self cluster. While
   * `false`, the board is locked to the `row` arrangement and the Settings
   * arrangement toggle is hidden, so the layout is unreachable.
   */
  wraparoundBoardLayout: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
