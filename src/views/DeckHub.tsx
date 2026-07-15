import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { HubTopDecks } from "@/components/deck/HubTopDecks";
import type { HubSort } from "@/api/hub";
import { useHubStore } from "@/stores/useHubStore";
import { FORMAT_DISPLAY } from "@/lib/constants";

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
    <Button variant={active ? "secondary" : "ghost"} size="sm" onClick={onClick}>
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

  const list = useHubStore((s) => s.list);
  const listError = useHubStore((s) => s.listError);
  const fetchDecks = useHubStore((s) => s.fetchDecks);

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
      <div className="px-4 py-3 border-b shrink-0 flex items-center gap-1">
        <h2 className="text-lg font-semibold flex-1">Deck Hub</h2>
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
          <div className="mt-2 flex items-center gap-1 px-2 py-1.5 shrink-0 flex-wrap">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search decks, authors, commanders…"
              className="h-6 max-w-56 text-xs"
            />
            <div className="flex items-center gap-1 flex-wrap">
              <SegmentedButton active={format === ""} onClick={() => setFormat("")}>
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
            <div className="ml-auto flex items-center gap-1">
              <SegmentedButton active={sort === "newest"} onClick={() => setSort("newest")}>
                Newest
              </SegmentedButton>
              <SegmentedButton active={sort === "name"} onClick={() => setSort("name")}>
                Name
              </SegmentedButton>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4">
              {listError ? (
                <p className="text-sm text-destructive">{listError}</p>
              ) : list === null ? (
                <p className="text-sm text-muted-foreground">Loading decks…</p>
              ) : list.decks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <p className="text-lg font-semibold">No decks here yet</p>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Be the first — open My Decks and publish one of your brews to the hub.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {list.decks.map((deck) => (
                    <HubDeckCard key={deck.id} deck={deck} onOpen={() => setPreviewId(deck.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {list !== null && list.total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 border-t shrink-0">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
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
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
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
        deckId={previewId}
        onClose={() => setPreviewId(null)}
        onUnpublished={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
