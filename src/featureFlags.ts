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
  // Deck Hub (browse/publish shared decks + top decks). Public browse, play and
  // copy need no session, so this stands alone; publishing and favorites stay
  // gated behind `accounts` below.
  deckHub: true,
  // Hub accounts (OAuth + email sign-in, deck ownership). Still dark at compile
  // time because both sign-in flows hand off to `WEB_APP_URL` and there is no
  // route back into a desktop window: the hub sends OAuth to
  // `{public_url}/api/auth/callback/{provider}` then on to `web_app_url`
  // (`auth/oauth.rs`), and magic links to `{web_app_url}/auth/callback`
  // (`auth/email.rs`). The web image turns this on at runtime, where that
  // handoff lands back on the same origin.
  accounts: false,
  // Email (magic-link) sign-in inside the accounts dialog. Gated by `accounts`.
  emailSignIn: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (featureFlags[flag]) return true;
  const browserDevelopment =
    import.meta.env.DEV &&
    import.meta.env.MODE !== "test" &&
    typeof window !== "undefined" &&
    !("__TAURI_INTERNALS__" in window);
  if (browserDevelopment && (flag === "accounts" || flag === "deckHub")) return true;
  return (
    typeof window !== "undefined" && window.__MANABREW_RUNTIME__?.featureFlags?.[flag] === true
  );
}
