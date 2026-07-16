/**
 * Single source of truth for compile-time feature flags. Add a boolean here
 * (default `false` to ship a feature dark) and read it via `isFeatureEnabled`.
 * Do not scatter feature gates anywhere else.
 */
export const featureFlags = {
  // Ironsmith trusted engine/runtime. The WASM ships as the `ironsmith-wasm` npm
  // dependency, so it is always bundled (`IRONSMITH_WASM_AVAILABLE` is a static
  // `true`) and this flag stays on. The engine is still OFF until the user opts
  // in via Settings (`ironsmithRuntimeEnabled`) — the experimental engine ships
  // dark in prod by default.
  ironsmithRuntime: true,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
