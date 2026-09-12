import { create } from "zustand";
import { isFeatureEnabled } from "@/featureFlags";
import { STORAGE_KEYS } from "@/lib/constants";

let active = false;

const forgeEngineUrls = import.meta.glob(
  ["../../packages/forge-wasm/forgeharness.js", "../../packages/forge-wasm/forgeharness.js.wasm"],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;
export const FORGE_LAUNCHER_URL = forgeEngineUrls["../../packages/forge-wasm/forgeharness.js"];
export const FORGE_WASM_URL = forgeEngineUrls["../../packages/forge-wasm/forgeharness.js.wasm"];

interface ForgeWasmVerdict {
  url: string;
  ok: boolean;
  error?: string;
}

function storedVerdict(): ForgeWasmVerdict | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FORGE_WASM_VALIDATION);
    const verdict = raw ? (JSON.parse(raw) as ForgeWasmVerdict) : null;
    return verdict?.url === FORGE_WASM_URL ? verdict : null;
  } catch {
    return null;
  }
}

const useForgeWasmVerdictStore = create<{ verdict: ForgeWasmVerdict | null }>(() => ({
  verdict: storedVerdict(),
}));

export function hasForgeWasmVerdict(): boolean {
  return useForgeWasmVerdictStore.getState().verdict !== null;
}

export function recordForgeWasmVerdict(ok: boolean, error?: string): void {
  const verdict: ForgeWasmVerdict = { url: FORGE_WASM_URL, ok, error };
  localStorage.setItem(STORAGE_KEYS.FORGE_WASM_VALIDATION, JSON.stringify(verdict));
  useForgeWasmVerdictStore.setState({ verdict });
}

export function isForgeWasmSupported(): boolean {
  if (typeof window === "undefined") return true;
  // iOS is untested with the 72 MB module.
  const userAgent = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  return (
    window.crossOriginIsolated &&
    typeof window.SharedArrayBuffer !== "undefined" &&
    !isIOS &&
    useForgeWasmVerdictStore.getState().verdict?.ok !== false
  );
}

export function isForgeWasmHostingEnabled(): boolean {
  return isFeatureEnabled("forgeWasm") && isForgeWasmSupported();
}

export function useForgeWasmHostingEnabled(): boolean {
  useForgeWasmVerdictStore((state) => state.verdict);
  return isForgeWasmHostingEnabled();
}

// One trial game before the first browser-hosted table; the verdict is kept
// per engine build.
export function forgeWasmNeedsValidation(): boolean {
  return useForgeWasmVerdictStore.getState().verdict === null;
}

export function isForgeWasmActive(): boolean {
  return active;
}

export function setForgeWasmActive(value: boolean): void {
  active = value;
}
