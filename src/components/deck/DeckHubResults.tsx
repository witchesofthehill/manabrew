import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import type { DeckHubGroup, DeckHubView } from "@/components/deck/deckHub.types";
import type { DeckHubEntrySummary, HubDeckSummary } from "@/api/hubTypes";
import { FORMAT_DISPLAY, ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface DeckHubResultsProps {
  entries: DeckHubEntrySummary[];
  legacyDecks: HubDeckSummary[];
  domainV2: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  total: number;
  page: number;
  totalPages: number;
  hasFilters: boolean;
  view: DeckHubView;
  group: DeckHubGroup;
  onOpen: (id: string) => void;
  onFavorite: (entry: DeckHubEntrySummary) => void;
  onPage: (page: number) => void;
  onClear: () => void;
  onRetry: () => void;
}

function groupLabel(entry: DeckHubEntrySummary, group: DeckHubGroup) {
  if (group === "source") return entry.sourceKind === "preset" ? "Official presets" : "Community";
  if (group === "format") return FORMAT_DISPLAY[entry.format ?? ""] ?? entry.format ?? "Other";
  if (group === "color") return entry.colors === "C" ? "Colorless" : entry.colors || "Unknown";
  if (group === "tag") return entry.tags[0]?.name ?? "Untagged";
  return "Published decks";
}

export function DeckHubResults({
  entries,
  legacyDecks,
  domainV2,
  loading,
  loaded,
  error,
  total,
  page,
  totalPages,
  hasFilters,
  view,
  group,
  onOpen,
  onFavorite,
  onPage,
  onClear,
  onRetry,
}: DeckHubResultsProps) {
  const groups = new Map<string, DeckHubEntrySummary[]>();
  for (const entry of entries) {
    const label = groupLabel(entry, group);
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
              <p className="text-sm font-medium">DeckHub could not be loaded</p>
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
          ) : entries.length === 0 && legacyDecks.length === 0 ? (
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
          ) : domainV2 ? (
            <div className="space-y-6">
              {[...groups.entries()].map(([label, groupedEntries]) => (
                <section key={label}>
                  {group !== "none" && (
                    <div className="mb-2 flex items-baseline gap-2">
                      <h2 className="font-serif text-lg font-semibold">{label}</h2>
                      <span className="text-xs text-muted-foreground">{groupedEntries.length}</span>
                    </div>
                  )}
                  <div
                    className={cn(
                      view === "grid"
                        ? "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                        : "grid gap-3 xl:grid-cols-2",
                    )}
                  >
                    {groupedEntries.map((entry) => (
                      <DeckHubEntryCard
                        key={entry.id}
                        entry={entry}
                        variant={view}
                        onOpen={() => onOpen(entry.id)}
                        onFavorite={() => onFavorite(entry)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {legacyDecks.map((deck) => (
                <HubDeckCard key={deck.id} deck={deck} onOpen={() => onOpen(deck.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {loaded && totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t px-4 py-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            aria-label="Previous page"
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            aria-label="Next page"
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  );
}
