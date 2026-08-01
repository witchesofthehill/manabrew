import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckHubDiscover } from "@/components/deck/DeckHubDiscover";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { HubTopDeckSnapshots } from "@/components/deck/HubTopDeckSnapshots";
import { useHubStore } from "@/stores/useHubStore";

type HubTab = "discover" | "top";

export default function DeckHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedPreviewId = useRef<string | null>(null);
  const capabilities = useHubStore((state) => state.capabilities);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const capabilitiesError = useHubStore((state) => state.capabilitiesError);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const tab: HubTab = searchParams.get("tab") === "top" ? "top" : "discover";
  const deckId = searchParams.get("deck");
  const domainV2 = capabilities?.domainVersion === 2;

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  function selectTab(nextTab: HubTab) {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "top") next.set("tab", "top");
    else next.delete("tab");
    next.delete("page");
    setSearchParams(next);
  }

  function openPreview(id: string) {
    openedPreviewId.current = id;
    const next = new URLSearchParams(searchParams);
    next.set("deck", id);
    setSearchParams(next);
  }

  function closePreview() {
    if (!deckId) return;
    if (openedPreviewId.current === deckId) {
      openedPreviewId.current = null;
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("deck");
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-medium">Published decks you can inspect card by card</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every result and ranking opens the exact version its author shared.
          </p>
        </div>
        <div className="flex w-fit items-center gap-1 rounded-lg bg-muted/60 p-1">
          <Button
            variant={tab === "discover" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tab === "discover"}
            onClick={() => selectTab("discover")}
          >
            <Search className="mr-1 h-4 w-4" />
            Discover
          </Button>
          <Button
            variant={tab === "top" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tab === "top"}
            onClick={() => selectTab("top")}
          >
            <Trophy className="mr-1 h-4 w-4" />
            Top Decks
          </Button>
        </div>
      </div>

      {!capabilitiesLoaded && capabilitiesError ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div className="max-w-md">
            <p className="font-medium">Deck Hub could not be reached</p>
            <p className="mt-1 text-sm text-muted-foreground">{capabilitiesError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void loadCapabilities()}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              Try again
            </Button>
          </div>
        </div>
      ) : !capabilitiesLoaded ? (
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
          Loading the Deck Hub…
        </div>
      ) : tab === "discover" ? (
        <DeckHubDiscover domainV2={domainV2} onOpen={openPreview} />
      ) : domainV2 ? (
        <HubTopDeckSnapshots onOpenDeck={openPreview} />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div className="max-w-md">
            <Trophy className="mx-auto h-9 w-9 text-muted-foreground/50" />
            <p className="mt-3 font-medium">Top Decks are temporarily unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Rankings only appear when they contain published Deck Hub entries with viewable card
              snapshots.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => selectTab("discover")}
            >
              Browse publications
            </Button>
          </div>
        </div>
      )}

      <HubDeckPreviewDialog deckId={deckId} onClose={closePreview} />
    </div>
  );
}
