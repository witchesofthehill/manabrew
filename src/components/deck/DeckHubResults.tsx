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
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";

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
  onAuthor: (author: string) => void;
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
  onAuthor,
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
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const shortTouch = shortScreen && isTouch;

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
        <div className={cn("p-4 sm:px-6 lg:px-8", shortTouch && "p-2 sm:px-4")}>
          {!isTouch && (
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {loaded
                  ? `${total.toLocaleString()} ${total === 1 ? "publication" : "publications"}`
                  : "Loading publications…"}
              </p>
              {loading && loaded && <p className="text-xs text-muted-foreground">Updating…</p>}
            </div>
          )}
          {error ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium">Community could not be loaded</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : !loaded ? (
            <div
              className={cn(
                "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
                shortTouch && "grid-cols-3 gap-2 md:grid-cols-3",
              )}
            >
              {Array.from({ length: 10 }, (_, index) => (
                <div key={index} className="animate-pulse rounded-lg border bg-card p-2">
                  <div className="aspect-[16/9] rounded-md bg-muted" />
                  <div className="mt-2 h-3 w-3/4 rounded bg-muted" />
                  <div className="mt-2 h-2.5 w-1/2 rounded bg-muted" />
                </div>
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
                <Button variant="primary" asChild size="sm" className="mt-4">
                  <Link to={ROUTES.DECK_EDITOR}>Open My Decks</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className={cn("space-y-6", shortTouch && "space-y-3")}>
              {!hasFilters && <DeckHubCuratedSections onOpen={onOpen} onAuthor={onAuthor} />}
              {!hasFilters && (
                <h2 className={cn("font-serif text-xl font-semibold", shortTouch && "text-lg")}>
                  Explore all decks
                </h2>
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
                  <div
                    className={cn(
                      "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
                      shortTouch && "grid-cols-3 gap-2 md:grid-cols-3",
                    )}
                  >
                    {groupedEntries.map((entry) => (
                      <DeckHubEntryCard
                        key={entry.id}
                        entry={entry}
                        onOpen={() => onOpen(entry.id)}
                        onAuthorClick={onAuthor}
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
