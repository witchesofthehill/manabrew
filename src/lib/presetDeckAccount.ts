import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";

export function savePresetToAccountOnUse(presetKey: string | undefined) {
  if (!presetKey || useAuthStore.getState().status !== "signedIn") return;
  void useAccountDecksStore
    .getState()
    .forkPreset(presetKey)
    .catch(() => undefined);
}
