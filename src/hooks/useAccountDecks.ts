import { useEffect } from "react";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import type { AccountDeckDetail, AccountDeckSummary } from "@/api/hubTypes";

const EMPTY_DECKS: AccountDeckSummary[] = [];
const EMPTY_DETAILS: Record<string, AccountDeckDetail> = {};

export function useAccountDecks() {
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const authStatus = useAuthStore((state) => state.status);
  const capabilities = useHubStore((state) => state.capabilities);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const decksAccountId = useAccountDecksStore((state) => state.accountId);
  const storedDecks = useAccountDecksStore((state) => state.decks);
  const storedDetails = useAccountDecksStore((state) => state.details);
  const loading = useAccountDecksStore((state) => state.loading);
  const error = useAccountDecksStore((state) => state.error);
  const refresh = useAccountDecksStore((state) => state.refresh);
  const clear = useAccountDecksStore((state) => state.clear);
  const currentAccountLoaded = accountId !== null && decksAccountId === accountId;
  const decks = currentAccountLoaded ? storedDecks : EMPTY_DECKS;
  const details = currentAccountLoaded ? storedDetails : EMPTY_DETAILS;

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
