import { useEffect } from "react";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import type { HubDeckSummary } from "@/api/hubTypes";

const MY_DECKS_REFRESH_INTERVAL_MS = 30_000;

export function useMyHubDecks() {
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const status = useAuthStore((state) => state.status);
  const myDecks = useHubStore((state) => state.myDecks);
  const loading = useHubStore((state) => state.myDecksLoading);
  const error = useHubStore((state) => state.myDecksError);
  const fetchMyDecks = useHubStore((state) => state.fetchMyDecks);
  const clearMyDecks = useHubStore((state) => state.clearMyDecks);
  const myEntries = useHubStore((state) => state.myEntries);
  const myEntriesLoading = useHubStore((state) => state.myEntriesLoading);
  const myEntriesError = useHubStore((state) => state.myEntriesError);
  const fetchMyEntries = useHubStore((state) => state.fetchMyEntries);
  const clearMyEntries = useHubStore((state) => state.clearMyEntries);
  const capabilities = useHubStore((state) => state.capabilities);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const enabled = isFeatureEnabled("deckHub") && isFeatureEnabled("accounts");
  const domainV2 = capabilities?.domainVersion === 2;

  useEffect(() => {
    if (enabled) void loadCapabilities();
  }, [enabled, loadCapabilities]);

  useEffect(() => {
    if (!enabled || status !== "signedIn" || !accountId) {
      clearMyDecks();
      clearMyEntries();
      return;
    }
    if (!capabilitiesLoaded) return;
    if (domainV2) {
      clearMyDecks();
      void fetchMyEntries(accountId);
    } else {
      clearMyEntries();
      void fetchMyDecks(accountId);
    }
  }, [
    accountId,
    capabilitiesLoaded,
    clearMyDecks,
    clearMyEntries,
    domainV2,
    enabled,
    fetchMyDecks,
    fetchMyEntries,
    status,
  ]);

  useEffect(() => {
    if (!enabled || !capabilitiesLoaded || status !== "signedIn" || !accountId) return;
    const refreshOnFocus = () =>
      void (domainV2 ? fetchMyEntries(accountId) : fetchMyDecks(accountId));
    const interval = window.setInterval(refreshOnFocus, MY_DECKS_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [accountId, capabilitiesLoaded, domainV2, enabled, fetchMyDecks, fetchMyEntries, status]);

  const versionedDecks: HubDeckSummary[] =
    myEntries?.entries.map((entry) => ({
      id: entry.id,
      name: entry.title,
      author: entry.author,
      description: entry.summary,
      format: entry.format,
      commanders: entry.commanders,
      colors: entry.colors,
      cardCount: entry.cardCount,
      coverCardName: entry.coverCardName,
      coverImageUrl: entry.coverImageUrl,
      createdAt: entry.publishedAt,
    })) ?? [];

  return {
    decks: domainV2 ? versionedDecks : (myDecks?.decks ?? []),
    loading: domainV2 ? myEntriesLoading : loading,
    error: domainV2 ? myEntriesError : error,
    signedIn: enabled && status === "signedIn" && accountId !== null,
    refresh: () =>
      enabled && accountId
        ? domainV2
          ? fetchMyEntries(accountId, true)
          : fetchMyDecks(accountId, true)
        : Promise.resolve(),
  };
}
