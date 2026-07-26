import { useEffect, useState } from "react";
import { fetchHubDecks } from "@/api/hub";
import { isFeatureEnabled } from "@/featureFlags";
import type { HubDeckSummary } from "@/api/hubTypes";

const SEARCH_DELAY_MS = 300;

export function useHubDeckSearch(search: string, format?: string) {
  const [result, setResult] = useState<{
    key: string;
    decks: HubDeckSummary[];
    error: string | null;
  }>({ key: "", decks: [], error: null });
  const [attempt, setAttempt] = useState(0);
  const enabled = isFeatureEnabled("deckHub");
  const key = `${format ?? ""}\n${search.trim()}\n${attempt}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchHubDecks({
        search: search.trim() || undefined,
        format: format || undefined,
        sort: "newest",
        page: 1,
        pageSize: 10,
      })
        .then((result) => {
          if (!cancelled) setResult({ key, decks: result.decks, error: null });
        })
        .catch((err) => {
          if (!cancelled) {
            setResult({
              key,
              decks: [],
              error: err instanceof Error ? err.message : "Failed to load Deck Hub decks",
            });
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, enabled, format, key, search]);

  const current = enabled && result.key === key;
  return {
    decks: current ? result.decks : [],
    loading: enabled && !current,
    error: current ? result.error : null,
    enabled,
    retry: () => setAttempt((value) => value + 1),
  };
}
