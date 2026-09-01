import { isFeatureEnabled } from "@/featureFlags";

let active = false;

export function isForgeWasmHostingEnabled(): boolean {
  return isFeatureEnabled("forgeWasm");
}

export function isForgeWasmActive(): boolean {
  return active;
}

export function setForgeWasmActive(value: boolean): void {
  active = value;
}
