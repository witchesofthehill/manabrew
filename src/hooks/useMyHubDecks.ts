import { useEffect } from "react";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";

const MY_DECKS_REFRESH_INTERVAL_MS = 30_000;

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

  useEffect(() => {
    if (!enabled || status !== "signedIn" || !accountId) return;
    const refreshOnFocus = () => void fetchMyDecks(accountId);
    const interval = window.setInterval(refreshOnFocus, MY_DECKS_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [accountId, enabled, fetchMyDecks, status]);

  return {
    decks: myDecks?.decks ?? [],
    loading,
    error,
    signedIn: status === "signedIn" && accountId !== null,
    refresh: () => (accountId ? fetchMyDecks(accountId, true) : Promise.resolve()),
  };
}
