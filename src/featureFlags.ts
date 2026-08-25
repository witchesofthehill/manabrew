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
  // copy need no session; publishing and favorites also need `accounts`.
  deckHub: true,
  // Hub accounts (OAuth + email sign-in, deck ownership). Desktop never uses the
  // `WEB_APP_URL` redirect: an OAuth start with `client: "desktop"` ends on the
  // hub's own code page and the app exchanges the pasted code at
  // `/api/auth/exchange`, and the login email carries a code alongside its link.
  accounts: true,
  // Email sign-in inside the accounts dialog. Code entry, so desktop-safe.
  emailSignIn: true,
  // Forge compiled to WebAssembly (GraalVM Web Image) as the offline engine,
  // in place of the Rust one. Ships dark: staging turns it on with FORGE_WASM,
  // and browser development turns it on automatically. Either way the flag only
  // exposes the Settings toggle — the engine stays off until the player opts in
  // (`forgeWasmEnabled`), the same shape as the Ironsmith runtime.
  forgeWasm: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (featureFlags[flag]) return true;
  const browserDevelopment =
    import.meta.env.DEV &&
    import.meta.env.MODE !== "test" &&
    typeof window !== "undefined" &&
    !("__TAURI_INTERNALS__" in window);
  if (browserDevelopment && (flag === "accounts" || flag === "deckHub" || flag === "forgeWasm")) {
    return true;
  }
  return (
    typeof window !== "undefined" && window.__MANABREW_RUNTIME__?.featureFlags?.[flag] === true
  );
}
