import { isFeatureEnabled } from "@/featureFlags";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

/**
 * Whether offline play should run Forge compiled to WebAssembly in-process.
 *
 * Two gates, matching the Ironsmith runtime: the deployment ships the flag and
 * the player opts in from Settings. It is the engine's identity, not just a
 * worker choice — the offline engine reports itself as Forge because that is
 * what is running, and the hosted-node path has to stand aside since this Forge
 * needs no node at all.
 */
export function isForgeWasmSelected(): boolean {
  return isFeatureEnabled("forgeWasm") && usePreferencesStore.getState().forgeWasmEnabled;
}
