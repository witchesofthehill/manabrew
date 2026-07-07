/**
 * Single source of truth for compile-time feature flags. Add a boolean here
 * (default `false` to ship a feature dark) and read it via `isFeatureEnabled`.
 * Do not scatter feature gates anywhere else.
 */
export const featureFlags = {
  // Ironsmith trusted engine/runtime. Requires the `ironsmith` submodule built
  // (./ironsmith/rebuild-wasm.sh + `yarn sync:ironsmith`); without it the sync
  // script installs a stub and this stays off, so the app still builds/ships.
  ironsmithRuntime: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
