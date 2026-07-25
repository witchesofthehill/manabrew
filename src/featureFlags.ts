/**
 * Single source of truth for compile-time feature flags. Add a boolean here
 * (default `false` to ship a feature dark) and read it via `isFeatureEnabled`.
 * Do not scatter feature gates anywhere else. A deployment can also turn a
 * flag on at runtime via `window.__MANABREW_RUNTIME__.featureFlags` (config.js,
 * written by the web image entrypoint) — runtime can only enable, not disable.
 */
export const featureFlags = {
  // Ironsmith trusted engine/runtime. The WASM ships as the `ironsmith-wasm` npm
  // dependency, so it is always bundled (`IRONSMITH_WASM_AVAILABLE` is a static
  // `true`) and this flag stays on. The engine is still OFF until the user opts
  // in via Settings (`ironsmithRuntimeEnabled`) — the experimental engine ships
  // dark in prod by default.
  ironsmithRuntime: true,
  // Deck Hub (browse/publish shared decks + top decks). Ships dark until the
  // api.manabrew.app service is deployed and the flow has had a manual pass.
  deckHub: false,
  // Hub accounts (OAuth + email sign-in, deck ownership). Ships dark until the
  // prod OAuth apps and the Resend domain are registered. Hub publishing
  // requires a session once the hub enforces auth, so flip this before deckHub.
  accounts: false,
  // Email (magic-link) sign-in inside the accounts dialog. Hidden until the
  // Resend domain is registered; OAuth sign-in is unaffected.
  emailSignIn: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (featureFlags[flag]) return true;
  return (
    typeof window !== "undefined" && window.__MANABREW_RUNTIME__?.featureFlags?.[flag] === true
  );
}
