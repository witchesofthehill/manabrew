import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getPlatformType } from "@/platform";

/**
 * Caching the platform pick lost a race: if the very first call landed
 * before Tauri's `__TAURI_INTERNALS__` was injected (or after an HMR
 * reset of this module), the singleton locked in browser `fetch` for
 * the rest of the session, and every cross-origin request CORS-failed.
 * Re-check on every call — `getPlatformType` is just a `window` probe.
 */
export function platformFetch(input: string, init?: RequestInit): Promise<Response> {
  const merged = { ...init, redirect: init?.redirect ?? "follow" };
  if (getPlatformType() === "tauri") {
    return tauriFetch(input, { ...merged, maxRedirections: 10 }) as Promise<Response>;
  }
  return fetch(input, merged);
}
