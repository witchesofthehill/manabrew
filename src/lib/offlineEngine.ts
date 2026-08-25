import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { isForgeWasmSelected } from "@/lib/forgeWasm";
import { getPlatform } from "@/platform";
import { isTauriForgeRoomAvailable } from "@/stores/useForgeRoomAvailabilityStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { EngineKind } from "@/types/server";

export function resolveOfflineEngine(lastOfflineEngine?: EngineKind | null): EngineKind {
  // Forge compiled to wasm is Forge: report it as such so the label, the preset
  // filter and the legality rules all match what is actually adjudicating.
  if (isForgeWasmSelected()) return "Forge";
  if (getPlatform().type === "tauri") {
    return isTauriForgeRoomAvailable() ? "Forge" : "Manabrew";
  }
  const last = lastOfflineEngine ?? usePreferencesStore.getState().lastOfflineEngine;
  if (last === "Forge" && !isHostedEngineAvailable()) return "Manabrew";
  return last ?? (isHostedEngineAvailable() ? "Forge" : "Manabrew");
}
