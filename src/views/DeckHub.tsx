import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { HubTopDecks } from "@/components/deck/HubTopDecks";
import type { HubSort } from "@/api/hub";
import { useHubDeckPlaytest, useQuickPlaytest } from "@/hooks/useQuickPlaytest";
import { useHubStore } from "@/stores/useHubStore";
import { FORMAT_DISPLAY, ROUTES } from "@/lib/constants";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const HUB_FORMATS = ["commander", "standard", "pioneer", "modern", "pauper", "brawl"] as const;

type HubTab = "browse" | "top";

function SegmentedButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export default function DeckHub() {
  const [tab, setTab] = useState<HubTab>("browse");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [format, setFormat] = useState<string>("");
  const [sort, setSort] = useState<HubSort>("newest");
  const [page, setPage] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDeckId = searchParams.get("deck");

  const list = useHubStore((s) => s.list);
  const listLoading = useHubStore((s) => s.listLoading);
  const listError = useHubStore((s) => s.listError);
  const fetchDecks = useHubStore((s) => s.fetchDecks);
  const { quickPlaytest, playtestDialog } = useQuickPlaytest();
  const hubPlaytest = useHubDeckPlaytest(quickPlaytest);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void fetchDecks({
      search: debouncedSearch || undefined,
      format: format || undefined,
      sort,
      page,
      pageSize: PAGE_SIZE,
    });
  }, [fetchDecks, debouncedSearch, format, sort, page, refreshKey]);

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div className="h-full flex flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b px-4 py-3 sm:px-6 lg:px-8">
        <SegmentedButton active={tab === "browse"} onClick={() => setTab("browse")}>
          <Search className="mr-1 h-4 w-4" />
          Browse
        </SegmentedButton>
        <SegmentedButton active={tab === "top"} onClick={() => setTab("top")}>
          <Trophy className="mr-1 h-4 w-4" />
          Top Decks
        </SegmentedButton>
      </div>

      {tab === "browse" ? (
        <>
          <div className="mt-2 flex shrink-0 flex-col gap-2 px-4 py-1.5 sm:flex-row sm:items-center sm:px-6 lg:px-8">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search Deck Hub"
              placeholder="Search decks, authors, commanders…"
              className="h-8 w-full text-xs pointer-coarse:h-10 pointer-coarse:text-base sm:max-w-56"
            />
            <div className="flex min-w-0 items-center gap-2">
              <div
                role="group"
                aria-label="Filter Deck Hub by format"
                className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 pb-1 no-scrollbar"
              >
                <SegmentedButton
                  active={format === ""}
                  onClick={() => {
                    setFormat("");
                    setPage(1);
                  }}
                >
                  All
                </SegmentedButton>
                {HUB_FORMATS.map((f) => (
                  <SegmentedButton
                    key={f}
                    active={format === f}
                    onClick={() => {
                      setFormat(f);
                      setPage(1);
                    }}
                  >
                    {FORMAT_DISPLAY[f] ?? f}
                  </SegmentedButton>
                ))}
              </div>
              <select
                value={sort}
                aria-label="Sort Deck Hub"
                className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs pointer-coarse:h-10 pointer-coarse:text-base"
                onChange={(event) => {
                  setSort(event.target.value as HubSort);
                  setPage(1);
                }}
              >
                <option value="newest">Newest</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4 sm:px-6 lg:px-8">
              {listError ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                  <span className="min-w-0 break-words">{listError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRefreshKey((key) => key + 1)}
                  >
                    Retry
                  </Button>
                </div>
              ) : list === null ? (
                <p className="text-sm text-muted-foreground">Loading decks…</p>
              ) : list.decks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  {debouncedSearch || format ? (
                    <>
                      <p className="text-lg font-semibold">No published decks match</p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        Try another name or format. Leaderboard decks are not always published.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearch("");
                          setDebouncedSearch("");
                          setFormat("");
                          setPage(1);
                        }}
                      >
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-semibold">No decks here yet</p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        Be the first — open My Decks and publish one of your brews to the hub.
                      </p>
                      <Button asChild size="sm">
                        <Link to={ROUTES.DECK_EDITOR}>Open My Decks</Link>
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {list.decks.map((deck) => (
                    <HubDeckCard
                      key={deck.id}
                      deck={deck}
                      onOpen={() => setPreviewId(deck.id)}
                      onPlaytest={() => hubPlaytest(deck.id)}
                    />
                  ))}
                </div>
              )}
              {listLoading && list !== null && (
                <p className="mt-3 text-xs text-muted-foreground">Updating decks…</p>
              )}
            </div>
          </div>

          {list !== null && list.total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 border-t shrink-0">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                aria-label="Previous page"
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                aria-label="Next page"
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      ) : (
        <HubTopDecks
          onSearchDeck={(name) => {
            setSearch(name);
            setTab("browse");
          }}
        />
      )}

      <HubDeckPreviewDialog
        deckId={previewId ?? urlDeckId}
        onClose={() => {
          setPreviewId(null);
          if (urlDeckId) setSearchParams({}, { replace: true });
        }}
        onUnpublished={() => setRefreshKey((k) => k + 1)}
      />
      {playtestDialog}
    </div>
  );
}
