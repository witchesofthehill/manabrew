import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { getPlatform } from "@/platform";
import { isTauriForgeRoomAvailable } from "@/stores/useForgeRoomAvailabilityStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { EngineKind } from "@/types/server";

export function resolveOfflineEngine(lastOfflineEngine?: EngineKind | null): EngineKind {
  if (getPlatform().type === "tauri") {
    return isTauriForgeRoomAvailable() ? "Forge" : "Manabrew";
  }
  const last = lastOfflineEngine ?? usePreferencesStore.getState().lastOfflineEngine;
  if (last === "Forge" && !isHostedEngineAvailable()) return "Manabrew";
  return last ?? (isHostedEngineAvailable() ? "Forge" : "Manabrew");
}
