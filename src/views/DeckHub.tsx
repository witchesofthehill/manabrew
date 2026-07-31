import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { HubTopDecks } from "@/components/deck/HubTopDecks";
import { HubTopDeckSnapshots } from "@/components/deck/HubTopDeckSnapshots";
import type { DeckHubSort, HubSort, TopDecksWindow } from "@/api/hub";
import type { TopDeckStat } from "@/api/hubTypes";
import { useHubStore } from "@/stores/useHubStore";
import { FORMAT_DISPLAY, ROUTES } from "@/lib/constants";
import { useAuthStore } from "@/stores/useAuthStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedPreviewId = useRef<string | null>(null);
  const initialSearch = searchParams.get("q") ?? "";
  const initialFormat = searchParams.get("format") ?? "";
  const [tab, setTab] = useState<HubTab>(searchParams.get("tab") === "top" ? "top" : "browse");
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [format, setFormat] = useState<string>(
    HUB_FORMATS.some((value) => value === initialFormat) ? initialFormat : "",
  );
  const [sort, setSort] = useState<DeckHubSort>(
    searchParams.get("sort") === "name"
      ? "name"
      : searchParams.get("sort") === "favorites"
        ? "favorites"
        : "newest",
  );
  const [tag, setTag] = useState(searchParams.get("tag") ?? "");
  const [topWindow, setTopWindow] = useState<TopDecksWindow>(() =>
    getInitialTopWindow(searchParams.get("period")),
  );
  const [page, setPage] = useState(() => getInitialPage(searchParams.get("page")));
  const [refreshKey, setRefreshKey] = useState(0);
  const urlDeckId = searchParams.get("deck");

  const list = useHubStore((s) => s.list);
  const listLoading = useHubStore((s) => s.listLoading);
  const listError = useHubStore((s) => s.listError);
  const fetchDecks = useHubStore((s) => s.fetchDecks);
  const capabilities = useHubStore((s) => s.capabilities);
  const capabilitiesLoaded = useHubStore((s) => s.capabilitiesLoaded);
  const loadCapabilities = useHubStore((s) => s.loadCapabilities);
  const entries = useHubStore((s) => s.entries);
  const entriesLoading = useHubStore((s) => s.entriesLoading);
  const entriesError = useHubStore((s) => s.entriesError);
  const fetchEntries = useHubStore((s) => s.fetchEntries);
  const tags = useHubStore((s) => s.tags);
  const fetchTags = useHubStore((s) => s.fetchTags);
  const setFavorite = useHubStore((s) => s.setFavorite);
  const viewerAccountId = useAuthStore((s) =>
    s.status === "signedIn" ? (s.account?.id ?? null) : null,
  );
  const signedIn = viewerAccountId !== null;
  const showSignIn = useSignInDialog((s) => s.show);
  const domainV2 = capabilities?.domainVersion === 2;

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);
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
    if (tag) next.set("tag", tag);
    else next.delete("tag");
    if (sort !== "newest") next.set("sort", sort);
    else next.delete("sort");
    if (topWindow !== "30d") next.set("period", topWindow);
    else next.delete("period");
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [format, page, search, searchParams, setSearchParams, sort, tab, tag, topWindow]);

  useEffect(() => {
    if (!capabilitiesLoaded) return;
    if (tab !== "browse") return;
    if (domainV2) {
      void fetchEntries({
        search: debouncedSearch || undefined,
        format: format || undefined,
        tag: tag || undefined,
        sort,
        page,
        pageSize: PAGE_SIZE,
      });
    } else {
      void fetchDecks({
        search: debouncedSearch || undefined,
        format: format || undefined,
        sort: sort === "favorites" ? "newest" : (sort as HubSort),
        page,
        pageSize: PAGE_SIZE,
      });
    }
  }, [
    fetchDecks,
    fetchEntries,
    debouncedSearch,
    capabilitiesLoaded,
    domainV2,
    format,
    sort,
    tag,
    page,
    refreshKey,
    tab,
    viewerAccountId,
  ]);

  useEffect(() => {
    if (domainV2) void fetchTags();
  }, [domainV2, fetchTags]);

  const activeList = domainV2 ? entries : list;
  const activeLoading = domainV2 ? entriesLoading : listLoading;
  const activeError = domainV2 ? entriesError : listError;
  const activeItems = domainV2 ? (entries?.entries ?? []) : (list?.decks ?? []);
  const totalPages = activeList ? Math.max(1, Math.ceil(activeList.total / PAGE_SIZE)) : 1;
  const hasFilters = Boolean(search || format || tag);

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setFormat("");
    setTag("");
    setPage(1);
  }

  function openPreview(deckId: string) {
    openedPreviewId.current = deckId;
    const next = new URLSearchParams(searchParams);
    next.set("deck", deckId);
    setSearchParams(next);
  }

  function closePreview() {
    if (!urlDeckId) return;
    if (openedPreviewId.current === urlDeckId) {
      openedPreviewId.current = null;
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("deck");
    setSearchParams(next, { replace: true });
  }

  function openTopDeck(stat: TopDeckStat) {
    if (stat.publishedDeckId) openPreview(stat.publishedDeckId);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="min-w-0 text-sm text-muted-foreground">
          Discover community decks, inspect every card, and start playing.
        </p>
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
                    setSort(event.target.value as DeckHubSort);
                    setPage(1);
                  }}
                >
                  <option value="newest">Newest first</option>
                  <option value="name">Deck name</option>
                  {domainV2 && <option value="favorites">Most favorited</option>}
                </select>
                {activeList && (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {activeList.total.toLocaleString()} {activeList.total === 1 ? "deck" : "decks"}
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
            {domainV2 && tags.length > 0 && (
              <div
                role="group"
                aria-label="Filter Deck Hub by tag"
                className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 pb-1 no-scrollbar"
              >
                <SegmentedButton
                  active={tag === ""}
                  onClick={() => {
                    setTag("");
                    setPage(1);
                  }}
                >
                  All tags
                </SegmentedButton>
                {tags.map((item) => (
                  <SegmentedButton
                    key={item.id}
                    active={tag === item.slug}
                    onClick={() => {
                      setTag(item.slug);
                      setPage(1);
                    }}
                  >
                    {item.name}
                  </SegmentedButton>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4 sm:px-6 lg:px-8">
              {activeError ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                  <span className="min-w-0 break-words">{activeError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRefreshKey((key) => key + 1)}
                  >
                    Retry
                  </Button>
                </div>
              ) : activeList === null ? (
                <div
                  className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                  aria-label="Loading decks"
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <HubDeckSkeleton key={index} />
                  ))}
                </div>
              ) : activeItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  {debouncedSearch || format || tag ? (
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
                  {domainV2
                    ? entries?.entries.map((entry) => (
                        <DeckHubEntryCard
                          key={entry.id}
                          entry={entry}
                          onOpen={() => openPreview(entry.id)}
                          onFavorite={() => {
                            if (!signedIn) {
                              showSignIn();
                              return;
                            }
                            void setFavorite(entry.id, !entry.favorited).catch((error) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Failed to update favorite",
                              ),
                            );
                          }}
                        />
                      ))
                    : list?.decks.map((deck) => (
                        <HubDeckCard
                          key={deck.id}
                          deck={deck}
                          onOpen={() => openPreview(deck.id)}
                        />
                      ))}
                </div>
              )}
              {activeLoading && activeList !== null && (
                <p className="mt-3 text-xs text-muted-foreground">Updating decks…</p>
              )}
            </div>
          </div>

          {activeList !== null && activeList.total > PAGE_SIZE && (
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
      ) : !capabilitiesLoaded ? (
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
          Loading Deck Hub…
        </div>
      ) : domainV2 ? (
        <HubTopDeckSnapshots onOpenDeck={openPreview} />
      ) : (
        <HubTopDecks
          timeWindow={topWindow}
          onTimeWindowChange={setTopWindow}
          onOpenDeck={openTopDeck}
        />
      )}

      <HubDeckPreviewDialog
        deckId={urlDeckId}
        onClose={closePreview}
        onUnpublished={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
