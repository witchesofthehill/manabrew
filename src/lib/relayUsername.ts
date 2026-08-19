import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function relayUsername(): string {
  const auth = useAuthStore.getState();
  if (isFeatureEnabled("accounts") && auth.status === "signedIn" && auth.account) {
    return auth.account.handle;
  }
  return usePreferencesStore.getState().serverUsername;
}
