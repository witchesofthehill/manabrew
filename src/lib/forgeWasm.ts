import { create } from "zustand";
import { isFeatureEnabled } from "@/featureFlags";
import { STORAGE_KEYS } from "@/lib/constants";

// Keep in sync with `EngineGate` in manabrew-relay-protocol; the relay reads
// these strings straight off `Authenticate`.
export type EngineGate =
  | "in_browser"
  | "ios"
  | "isolation"
  | "trial_timeout"
  | "trial_failed"
  | "disabled"
  | "unknown";

let active = false;

const forgeEngineUrls = import.meta.glob(
  ["../../packages/forge-wasm/forgeharness.js", "../../packages/forge-wasm/forgeharness.js.wasm"],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;
export const FORGE_LAUNCHER_URL = forgeEngineUrls["../../packages/forge-wasm/forgeharness.js"];
export const FORGE_WASM_URL = forgeEngineUrls["../../packages/forge-wasm/forgeharness.js.wasm"];

// A trial that ran out of time says nothing about the browser: the module is
// 72 MB and the connection may simply have been slow. Only a trial the engine
// itself failed is permanent.
export const TRIAL_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
export const MAX_TRIAL_ATTEMPTS = 3;

type ForgeWasmFailure = "timeout" | "engine";

interface ForgeWasmVerdict {
  url: string;
  ok: boolean | null;
  failure?: ForgeWasmFailure;
  at?: number;
  attempts?: number;
  error?: string;
}

function storedVerdict(): ForgeWasmVerdict | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FORGE_WASM_VALIDATION);
    const verdict = raw ? (JSON.parse(raw) as ForgeWasmVerdict) : null;
    if (verdict?.url !== FORGE_WASM_URL) return null;
    // A trial that began and never recorded an outcome took the page with it,
    // which is the slow-download case, not a verdict on the browser.
    return verdict.ok === null
      ? {
          ...verdict,
          ok: false,
          failure: "timeout",
          at: verdict.at ?? 0,
          error: "the previous attempt did not complete",
        }
      : verdict;
  } catch {
    return null;
  }
}

const useForgeWasmVerdictStore = create<{ verdict: ForgeWasmVerdict | null }>(() => ({
  verdict: storedVerdict(),
}));

function isRetryable(verdict: ForgeWasmVerdict | null): boolean {
  if (!verdict || verdict.ok !== false || verdict.failure !== "timeout") return false;
  if ((verdict.attempts ?? 1) >= MAX_TRIAL_ATTEMPTS) return false;
  return Date.now() - (verdict.at ?? 0) >= TRIAL_RETRY_AFTER_MS;
}

export function hasForgeWasmVerdict(): boolean {
  return useForgeWasmVerdictStore.getState().verdict !== null;
}

export function recordForgeWasmVerdict(
  ok: boolean,
  failure?: ForgeWasmFailure,
  error?: string,
): void {
  const previous = useForgeWasmVerdictStore.getState().verdict;
  const verdict: ForgeWasmVerdict = {
    url: FORGE_WASM_URL,
    ok,
    failure: ok ? undefined : failure,
    at: Date.now(),
    attempts: ok ? undefined : (previous?.attempts ?? 0) + 1,
    error,
  };
  localStorage.setItem(STORAGE_KEYS.FORGE_WASM_VALIDATION, JSON.stringify(verdict));
  useForgeWasmVerdictStore.setState({ verdict });
}

export function beginForgeWasmTrial(): void {
  const previous = useForgeWasmVerdictStore.getState().verdict;
  const pending: ForgeWasmVerdict = {
    url: FORGE_WASM_URL,
    ok: null,
    at: Date.now(),
    attempts: previous?.attempts ?? 0,
  };
  localStorage.setItem(STORAGE_KEYS.FORGE_WASM_VALIDATION, JSON.stringify(pending));
}

function isIOS(): boolean {
  const userAgent = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
  );
}

export function forgeWasmGate(): EngineGate {
  if (typeof window === "undefined") return "unknown";
  // iOS is untested with the 72 MB module.
  if (isIOS()) return "ios";
  if (!window.crossOriginIsolated || typeof window.SharedArrayBuffer === "undefined") {
    return "isolation";
  }
  const verdict = useForgeWasmVerdictStore.getState().verdict;
  if (verdict?.ok === false && !isRetryable(verdict)) {
    return verdict.failure === "timeout" ? "trial_timeout" : "trial_failed";
  }
  if (!isFeatureEnabled("forgeWasm")) return "disabled";
  return "in_browser";
}

export function isForgeWasmSupported(): boolean {
  if (typeof window === "undefined") return true;
  const gate = forgeWasmGate();
  return gate === "in_browser" || gate === "disabled";
}

export function isForgeWasmHostingEnabled(): boolean {
  return isFeatureEnabled("forgeWasm") && isForgeWasmSupported();
}

export function useForgeWasmHostingEnabled(): boolean {
  useForgeWasmVerdictStore((state) => state.verdict);
  return isForgeWasmHostingEnabled();
}

// One trial game before the first browser-hosted table; the verdict is kept
// per engine build, and a timed-out trial is retried on a later day.
export function forgeWasmNeedsValidation(): boolean {
  const verdict = useForgeWasmVerdictStore.getState().verdict;
  return verdict === null || isRetryable(verdict);
}

export function isForgeWasmActive(): boolean {
  return active;
}

export function setForgeWasmActive(value: boolean): void {
  active = value;
}
