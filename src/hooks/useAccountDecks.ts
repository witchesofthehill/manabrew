import { useEffect } from "react";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";

export function useAccountDecks() {
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const authStatus = useAuthStore((state) => state.status);
  const capabilities = useHubStore((state) => state.capabilities);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const decks = useAccountDecksStore((state) => state.decks);
  const details = useAccountDecksStore((state) => state.details);
  const loading = useAccountDecksStore((state) => state.loading);
  const error = useAccountDecksStore((state) => state.error);
  const refresh = useAccountDecksStore((state) => state.refresh);
  const clear = useAccountDecksStore((state) => state.clear);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    if (!capabilitiesLoaded) return;
    if (authStatus !== "signedIn" || !accountId || !capabilities?.accountDecks) {
      clear();
      return;
    }
    void refresh();
  }, [accountId, authStatus, capabilities, capabilitiesLoaded, clear, refresh]);

  return {
    decks,
    details,
    loading,
    error,
    available: capabilities?.accountDecks === true,
    signedIn: authStatus === "signedIn" && accountId !== null,
    refresh,
  };
}
