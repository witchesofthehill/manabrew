import { useEffect, useState } from "react";
import { fetchDeckHubEntries, type DeckHubSource } from "@/api/hub";
import { isFeatureEnabled } from "@/featureFlags";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import type { EngineKind } from "@/protocol";

const SEARCH_DELAY_MS = 300;

export function useHubDeckSearch(
  search: string,
  format?: string,
  active = true,
  engines?: EngineKind[],
  source?: DeckHubSource,
) {
  const [result, setResult] = useState<{
    key: string;
    decks: DeckHubEntrySummary[];
    error: string | null;
  }>({ key: "", decks: [], error: null });
  const [attempt, setAttempt] = useState(0);
  const enabled = isFeatureEnabled("deckHub") && active;
  const enginesKey = (engines ?? []).join(",");
  const key = `${format ?? ""}\n${search.trim()}\n${enginesKey}\n${source ?? ""}\n${attempt}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchDeckHubEntries({
        search: search.trim() || undefined,
        formats: format ? [format] : undefined,
        engines: enginesKey ? (enginesKey.split(",") as EngineKind[]) : undefined,
        source,
        sort: "newest",
        page: 1,
        pageSize: 10,
      })
        .then((result) => {
          if (!cancelled) setResult({ key, decks: result.entries, error: null });
        })
        .catch((err) => {
          if (!cancelled) {
            setResult({
              key,
              decks: [],
              error: err instanceof Error ? err.message : "Failed to load Community decks",
            });
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, enabled, enginesKey, format, key, search, source]);

  const current = enabled && result.key === key;
  return {
    decks: current ? result.decks : [],
    loading: enabled && !current,
    error: current ? result.error : null,
    enabled,
    retry: () => setAttempt((value) => value + 1),
  };
}
