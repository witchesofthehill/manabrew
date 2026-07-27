import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Layers3, Search, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { HubTopDecks } from "@/components/deck/HubTopDecks";
import type { HubSort, TopDecksWindow } from "@/api/hub";
import { useHubDeckPlaytest, useQuickPlaytest } from "@/hooks/useQuickPlaytest";
import { useHubStore } from "@/stores/useHubStore";
import { FORMAT_DISPLAY, ROUTES } from "@/lib/constants";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const HUB_FORMATS = ["commander", "standard", "pioneer", "modern", "pauper", "brawl"] as const;

type HubTab = "browse" | "top";

function getInitialPage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function getInitialTopWindow(value: string | null): TopDecksWindow {
  if (value === "7d" || value === "all") return value;
  return "30d";
}

function HubDeckSkeleton() {
  return (
    <div className="aspect-[4/3] animate-pulse overflow-hidden rounded-lg border bg-muted">
      <div className="h-full bg-gradient-to-t from-muted-foreground/10 to-transparent" />
    </div>
  );
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get("q") ?? "";
  const initialFormat = searchParams.get("format") ?? "";
  const [tab, setTab] = useState<HubTab>(searchParams.get("tab") === "top" ? "top" : "browse");
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [format, setFormat] = useState<string>(
    HUB_FORMATS.some((value) => value === initialFormat) ? initialFormat : "",
  );
  const [sort, setSort] = useState<HubSort>(
    searchParams.get("sort") === "name" ? "name" : "newest",
  );
  const [topWindow, setTopWindow] = useState<TopDecksWindow>(() =>
    getInitialTopWindow(searchParams.get("period")),
  );
  const [page, setPage] = useState(() => getInitialPage(searchParams.get("page")));
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const urlDeckId = searchParams.get("deck");

  const list = useHubStore((s) => s.list);
  const listLoading = useHubStore((s) => s.listLoading);
  const listError = useHubStore((s) => s.listError);
  const fetchDecks = useHubStore((s) => s.fetchDecks);
  const { quickPlaytest, playtestDialog } = useQuickPlaytest();
  const hubPlaytest = useHubDeckPlaytest(quickPlaytest);

  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (tab === "top") next.set("tab", "top");
    else next.delete("tab");
    if (search) next.set("q", search);
    else next.delete("q");
    if (format) next.set("format", format);
    else next.delete("format");
    if (sort === "name") next.set("sort", "name");
    else next.delete("sort");
    if (topWindow !== "30d") next.set("period", topWindow);
    else next.delete("period");
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [format, page, search, searchParams, setSearchParams, sort, tab, topWindow]);

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
  const hasFilters = Boolean(search || format);

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setFormat("");
    setPage(1);
  }

  function openPreview(deckId: string) {
    setPreviewId(deckId);
    const next = new URLSearchParams(searchParams);
    next.set("deck", deckId);
    setSearchParams(next, { replace: true });
  }

  function closePreview() {
    setPreviewId(null);
    if (!urlDeckId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("deck");
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers3 className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-lg font-semibold">Deck Hub</h1>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Discover community decks, inspect every card, and start playing.
          </p>
        </div>
        <div className="flex w-fit items-center gap-1 rounded-lg bg-muted/60 p-1">
          <SegmentedButton active={tab === "browse"} onClick={() => setTab("browse")}>
            <Search className="mr-1 h-4 w-4" />
            Browse
          </SegmentedButton>
          <SegmentedButton active={tab === "top"} onClick={() => setTab("top")}>
            <Trophy className="mr-1 h-4 w-4" />
            Top Decks
          </SegmentedButton>
        </div>
      </div>

      {tab === "browse" ? (
        <>
          <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search Deck Hub"
                  placeholder="Search decks, authors, commanders…"
                  className="h-9 pl-8 pr-8 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 sm:ml-auto">
                <select
                  value={sort}
                  aria-label="Sort Deck Hub"
                  className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
                  onChange={(event) => {
                    setSort(event.target.value as HubSort);
                    setPage(1);
                  }}
                >
                  <option value="newest">Newest first</option>
                  <option value="name">Deck name</option>
                </select>
                {list && (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {list.total.toLocaleString()} {list.total === 1 ? "deck" : "decks"}
                  </span>
                )}
              </div>
            </div>
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
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={clearFilters}
                >
                  Clear
                </Button>
              )}
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
                <div
                  className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                  aria-label="Loading decks"
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <HubDeckSkeleton key={index} />
                  ))}
                </div>
              ) : list.decks.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  {debouncedSearch || format ? (
                    <>
                      <p className="text-lg font-semibold">No published decks match</p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        Try another name or format. Leaderboard decks are not always published.
                      </p>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
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
                      onOpen={() => openPreview(deck.id)}
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
          timeWindow={topWindow}
          onTimeWindowChange={setTopWindow}
          onSearchDeck={(name) => {
            setSearch(name);
            setTab("browse");
          }}
        />
      )}

      <HubDeckPreviewDialog
        deckId={previewId ?? urlDeckId}
        onClose={closePreview}
        onUnpublished={() => setRefreshKey((k) => k + 1)}
      />
      {playtestDialog}
    </div>
  );
}
