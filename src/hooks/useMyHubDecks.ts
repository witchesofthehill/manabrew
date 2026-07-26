import { useEffect } from "react";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";

export function useMyHubDecks() {
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const status = useAuthStore((state) => state.status);
  const myDecks = useHubStore((state) => state.myDecks);
  const loading = useHubStore((state) => state.myDecksLoading);
  const error = useHubStore((state) => state.myDecksError);
  const fetchMyDecks = useHubStore((state) => state.fetchMyDecks);
  const clearMyDecks = useHubStore((state) => state.clearMyDecks);
  const enabled = isFeatureEnabled("deckHub") && isFeatureEnabled("accounts");

  useEffect(() => {
    if (!enabled || status !== "signedIn" || !accountId) {
      clearMyDecks();
      return;
    }
    void fetchMyDecks(accountId);
  }, [accountId, clearMyDecks, enabled, fetchMyDecks, status]);

  return {
    decks: myDecks?.decks ?? [],
    loading,
    error,
    signedIn: status === "signedIn" && accountId !== null,
    refresh: () => (accountId ? fetchMyDecks(accountId, true) : Promise.resolve()),
  };
}
