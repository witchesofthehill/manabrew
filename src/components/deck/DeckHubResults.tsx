import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Loader2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckHubCuratedSections } from "@/components/deck/DeckHubCuratedSections";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import type { DeckHubGroup } from "@/components/deck/deckHub.types";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import { FORMAT_DISPLAY, ROUTES } from "@/lib/constants";
import { useHubStore } from "@/stores/useHubStore";

interface DeckHubResultsProps {
  entries: DeckHubEntrySummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  total: number;
  hasFilters: boolean;
  resetKey: string;
  group: DeckHubGroup;
  onOpen: (id: string) => void;
  onFavorite?: (entry: DeckHubEntrySummary) => void;
  onLoadMore: () => void;
  onClear: () => void;
  onRetry: () => void;
}

function groupLabel(entry: DeckHubEntrySummary, group: DeckHubGroup) {
  if (group === "source") return entry.sourceKind === "preset" ? "Official presets" : "Community";
  if (group === "format") return FORMAT_DISPLAY[entry.format ?? ""] ?? entry.format ?? "Other";
  if (group === "color") return entry.colors || "Unknown";
  if (group === "tag") return entry.tags[0]?.name ?? "Untagged";
  return "Published decks";
}

export function DeckHubResults({
  entries,
  loading,
  loaded,
  error,
  total,
  hasFilters,
  resetKey,
  group,
  onOpen,
  onFavorite,
  onLoadMore,
  onClear,
  onRetry,
}: DeckHubResultsProps) {
  const groups = new Map<string, DeckHubEntrySummary[]>();
  for (const entry of entries) {
    const label = groupLabel(entry, group);
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const favoritePending = useHubStore((state) => state.favoritePending);
  const hasMore = entries.length < total;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  useEffect(() => {
    const target = loadMoreRef.current;
    const root = scrollRef.current;
    if (!target || !root || !loaded || loading || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { root, rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loaded, loading, onLoadMore]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:order-1">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4 sm:px-6 lg:px-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {loaded
                ? `${total.toLocaleString()} ${total === 1 ? "publication" : "publications"}`
                : "Loading publications…"}
            </p>
            {loading && loaded && <p className="text-xs text-muted-foreground">Updating…</p>}
          </div>
          {error ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium">Community could not be loaded</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : !loaded ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, index) => (
                <div key={index} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Layers className="h-9 w-9 text-muted-foreground/50" />
              <p className="mt-3 text-lg font-semibold">
                {hasFilters ? "No publications match" : "No decks here yet"}
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {hasFilters
                  ? "Try broadening the filters or searching for another card or commander."
                  : "Publish a version from My Decks to make its exact card snapshot discoverable."}
              </p>
              {hasFilters ? (
                <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild size="sm" className="mt-4">
                  <Link to={ROUTES.DECK_EDITOR}>Open My Decks</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {!hasFilters && <DeckHubCuratedSections onOpen={onOpen} />}
              {!hasFilters && (
                <div>
                  <h2 className="font-serif text-xl font-semibold">Explore all decks</h2>
                  <p className="text-xs text-muted-foreground">
                    Keep scrolling to discover more from the Community.
                  </p>
                </div>
              )}
              {[...groups.entries()].map(([label, groupedEntries]) => (
                <section key={label}>
                  {group !== "none" && (
                    <div className="mb-2 flex items-baseline gap-2">
                      <h2 className="font-serif text-lg font-semibold">
                        {group === "color" && label !== "Unknown" ? (
                          <>
                            <span className="sr-only">
                              {label === "C" ? "Colorless" : `${label} color identity`}
                            </span>
                            <span aria-hidden="true">
                              <ManaSymbols
                                cost={label
                                  .split("")
                                  .map((color) => `{${color}}`)
                                  .join("")}
                                size="lg"
                                className="m-0"
                              />
                            </span>
                          </>
                        ) : (
                          label
                        )}
                      </h2>
                      <span className="text-xs text-muted-foreground">{groupedEntries.length}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {groupedEntries.map((entry) => (
                      <DeckHubEntryCard
                        key={entry.id}
                        entry={entry}
                        onOpen={() => onOpen(entry.id)}
                        onFavorite={onFavorite ? () => onFavorite(entry) : undefined}
                        favoritePending={Boolean(favoritePending[entry.id])}
                      />
                    ))}
                  </div>
                </section>
              ))}
              <div ref={loadMoreRef} className="flex h-14 items-center justify-center">
                {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                {!hasMore && entries.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    You’ve reached the end of Community.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
