import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { isFeatureEnabled } from "@/featureFlags";

export function savePresetToAccountOnUse(presetKey: string | undefined) {
  if (!isFeatureEnabled("accounts") || !presetKey || useAuthStore.getState().status !== "signedIn")
    return;
  void useAccountDecksStore
    .getState()
    .forkPreset(presetKey)
    .catch(() => undefined);
}
