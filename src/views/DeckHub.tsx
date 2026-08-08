import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckHubDiscover } from "@/components/deck/DeckHubDiscover";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { HubTopDeckSnapshots } from "@/components/deck/HubTopDeckSnapshots";
import { useHubStore } from "@/stores/useHubStore";
import { ROUTES } from "@/lib/constants";

export default function DeckHub() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedPreviewId = useRef<string | null>(null);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const capabilitiesError = useHubStore((state) => state.capabilitiesError);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const topDecks = location.pathname === ROUTES.HUB_TOP;
  const deckId = searchParams.get("deck");

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    if (topDecks || searchParams.get("tab") !== "top") return;
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    next.delete("page");
    navigate({ pathname: ROUTES.HUB_TOP, search: next.toString() }, { replace: true });
  }, [navigate, searchParams, topDecks]);

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
      {!capabilitiesLoaded && capabilitiesError ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div className="max-w-md">
            <p className="font-medium">Community could not be reached</p>
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
          Loading Community…
        </div>
      ) : topDecks ? (
        <HubTopDeckSnapshots onOpenDeck={openPreview} />
      ) : (
        <DeckHubDiscover onOpen={openPreview} />
      )}

      <HubDeckPreviewDialog deckId={deckId} onClose={closePreview} />
    </div>
  );
}
