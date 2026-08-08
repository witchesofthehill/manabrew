import { useEffect } from "react";
import { isFeatureEnabled } from "@/featureFlags";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import type { AccountDeckDetail, AccountDeckSummary } from "@/api/hubTypes";

const EMPTY_DECKS: AccountDeckSummary[] = [];
const EMPTY_DETAILS: Record<string, AccountDeckDetail> = {};

export function useAccountDecks() {
  const enabled = isFeatureEnabled("accounts");
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const authStatus = useAuthStore((state) => state.status);
  const capabilities = useHubStore((state) => state.capabilities);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const capabilitiesError = useHubStore((state) => state.capabilitiesError);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const decksAccountId = useAccountDecksStore((state) => state.accountId);
  const storedDecks = useAccountDecksStore((state) => state.decks);
  const storedDetails = useAccountDecksStore((state) => state.details);
  const loading = useAccountDecksStore((state) => state.loading);
  const error = useAccountDecksStore((state) => state.error);
  const refresh = useAccountDecksStore((state) => state.refresh);
  const clear = useAccountDecksStore((state) => state.clear);
  const currentAccountLoaded = enabled && accountId !== null && decksAccountId === accountId;
  const resolved =
    authStatus !== "unknown" &&
    (!enabled ||
      capabilitiesError !== null ||
      (capabilitiesLoaded &&
        (authStatus !== "signedIn" ||
          capabilities?.accountDecks !== true ||
          (currentAccountLoaded && !loading))));
  const decks = currentAccountLoaded ? storedDecks : EMPTY_DECKS;
  const details = currentAccountLoaded ? storedDetails : EMPTY_DETAILS;

  useEffect(() => {
    if (enabled) void loadCapabilities();
  }, [enabled, loadCapabilities]);

  useEffect(() => {
    if (!enabled) {
      clear();
      return;
    }
    if (!capabilitiesLoaded) return;
    if (authStatus !== "signedIn" || !accountId || !capabilities?.accountDecks) {
      clear();
      return;
    }
    void refresh();
  }, [accountId, authStatus, capabilities, capabilitiesLoaded, clear, enabled, refresh]);

  return {
    decks,
    details,
    loading,
    error,
    available: enabled && capabilities?.accountDecks === true,
    signedIn: enabled && authStatus === "signedIn" && accountId !== null,
    resolved,
    refresh,
  };
}
