import { isFeatureEnabled } from "@/featureFlags";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

let active = false;

export function isForgeWasmHostingEnabled(): boolean {
  return isFeatureEnabled("forgeWasm") && usePreferencesStore.getState().forgeWasmEnabled;
}

export function isForgeWasmActive(): boolean {
  return active;
}

export function setForgeWasmActive(value: boolean): void {
  active = value;
}
