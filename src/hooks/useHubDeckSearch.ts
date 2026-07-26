import { useEffect, useState } from "react";
import { fetchHubDecks } from "@/api/hub";
import { isFeatureEnabled } from "@/featureFlags";
import type { HubDeckSummary } from "@/api/hubTypes";

const SEARCH_DELAY_MS = 300;

export function useHubDeckSearch(search: string, format?: string) {
  const [decks, setDecks] = useState<HubDeckSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const enabled = isFeatureEnabled("deckHub");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetchHubDecks({
        search: search.trim() || undefined,
        format: format || undefined,
        sort: "newest",
        page: 1,
        pageSize: 10,
      })
        .then((result) => {
          if (!cancelled) setDecks(result.decks);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load Deck Hub decks");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, enabled, format, search]);

  return { decks, loading, error, enabled, retry: () => setAttempt((value) => value + 1) };
}
