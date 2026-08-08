import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckHubDiscover } from "@/components/deck/DeckHubDiscover";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { HubTopDeckSnapshots } from "@/components/deck/HubTopDeckSnapshots";
import { cn } from "@/lib/utils";
import { useHubStore } from "@/stores/useHubStore";

type HubTab = "discover" | "top";

export default function DeckHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedPreviewId = useRef<string | null>(null);
  const capabilitiesLoaded = useHubStore((state) => state.capabilitiesLoaded);
  const capabilitiesError = useHubStore((state) => state.capabilitiesError);
  const loadCapabilities = useHubStore((state) => state.loadCapabilities);
  const tab: HubTab = searchParams.get("tab") === "top" ? "top" : "discover";
  const deckId = searchParams.get("deck");

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
      <nav aria-label="Community view" className="shrink-0 px-4 pt-4 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-xl grid-cols-2 rounded-2xl border border-border/70 bg-background/80 p-1.5 shadow-xl backdrop-blur-md">
          {(
            [
              { id: "discover", label: "Discover", hint: "Browse decks", icon: Search },
              { id: "top", label: "Top Decks", hint: "Community rankings", icon: Trophy },
            ] as const
          ).map(({ id, label, hint, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => selectTab(id)}
                className={cn(
                  "group flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 transition-[background-color,color,box-shadow] motion-reduce:transition-none sm:px-4",
                  active
                    ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors motion-reduce:transition-none",
                    active
                      ? "border-primary/30 bg-primary/15"
                      : "border-border/60 bg-muted/40 group-hover:border-border",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-semibold">{label}</span>
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                    {hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

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
      ) : tab === "discover" ? (
        <DeckHubDiscover onOpen={openPreview} />
      ) : (
        <HubTopDeckSnapshots onOpenDeck={openPreview} />
      )}

      <HubDeckPreviewDialog deckId={deckId} onClose={closePreview} />
    </div>
  );
}
