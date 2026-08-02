import { useEffect } from "react";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";

const REFRESH_INTERVAL_MS = 30_000;

export function useMyDeckHubEntries() {
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const status = useAuthStore((state) => state.status);
  const myEntries = useHubStore((state) => state.myEntries);
  const loading = useHubStore((state) => state.myEntriesLoading);
  const error = useHubStore((state) => state.myEntriesError);
  const fetchMyEntries = useHubStore((state) => state.fetchMyEntries);
  const clearMyEntries = useHubStore((state) => state.clearMyEntries);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const enabled = isFeatureEnabled("deckHub") && isFeatureEnabled("accounts");

  useEffect(() => {
    if (enabled) void loadCapabilities();
  }, [enabled, loadCapabilities]);

  useEffect(() => {
    if (!enabled || status !== "signedIn" || !accountId) {
      clearMyEntries();
      return;
    }
    if (!capabilitiesLoaded) return;
    void fetchMyEntries(accountId);
  }, [accountId, capabilitiesLoaded, clearMyEntries, enabled, fetchMyEntries, status]);

  useEffect(() => {
    if (!enabled || !capabilitiesLoaded || status !== "signedIn" || !accountId) return;
    const refreshOnFocus = () => void fetchMyEntries(accountId);
    const interval = window.setInterval(refreshOnFocus, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [accountId, capabilitiesLoaded, enabled, fetchMyEntries, status]);

  return {
    entries: myEntries?.entries ?? [],
    loading,
    error,
    signedIn: enabled && status === "signedIn" && accountId !== null,
    refresh: () => (enabled && accountId ? fetchMyEntries(accountId, true) : Promise.resolve()),
  };
}
