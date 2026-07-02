/**
 * Single source of truth for compile-time feature flags. Add a boolean here
 * (default `false` to ship a feature dark) and read it via `isFeatureEnabled`.
 * Do not scatter feature gates anywhere else. Currently empty.
 */
export const featureFlags = {} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
