import { isFeatureEnabled } from "@/featureFlags";

let active = false;

export function isForgeWasmSupported(): boolean {
  if (typeof window === "undefined") return true;
  // GraalVM Web Image currently emits a WASM opcode WebKit rejects during compilation.
  const userAgent = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  const isSafari =
    /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/.test(userAgent);
  return (
    window.crossOriginIsolated &&
    typeof window.SharedArrayBuffer !== "undefined" &&
    !isIOS &&
    !isSafari
  );
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
