import { isFeatureEnabled } from "@/featureFlags";

let active = false;

export function isForgeWasmSupported(): boolean {
  if (typeof window === "undefined") return true;
  // iOS is untested with the 72 MB module.
  const userAgent = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  return window.crossOriginIsolated && typeof window.SharedArrayBuffer !== "undefined" && !isIOS;
}

export function isForgeWasmHostingEnabled(): boolean {
  return isFeatureEnabled("forgeWasm") && isForgeWasmSupported();
}

export function isForgeWasmActive(): boolean {
  return active;
}

export function setForgeWasmActive(value: boolean): void {
  active = value;
}
