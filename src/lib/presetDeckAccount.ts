import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import { isFeatureEnabled } from "@/featureFlags";

export function savePresetToAccountOnUse(presetKey: string | undefined) {
  if (!isFeatureEnabled("accounts") || !presetKey || useAuthStore.getState().status !== "signedIn")
    return;
  const { capabilities, capabilitiesLoaded } = useHubStore.getState();
  if (capabilitiesLoaded && !capabilities?.accountDecks) return;
  const store = useAccountDecksStore.getState();
  if (store.decks.some((deck) => deck.derivedFromPresetKey === presetKey)) return;
  void store.forkPreset(presetKey).catch(() => undefined);
}
