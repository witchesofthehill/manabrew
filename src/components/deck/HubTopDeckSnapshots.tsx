import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { isFeatureEnabled } from "@/featureFlags";
import { cn } from "@/lib/utils";

const DEFAULT_BUCKET = "official-presets";

interface HubTopDeckSnapshotsProps {
  onOpenDeck: (id: string) => void;
}

export function HubTopDeckSnapshots({ onOpenDeck }: HubTopDeckSnapshotsProps) {
  const accountsEnabled = isFeatureEnabled("accounts");
  const viewerAccountId = useAuthStore((state) =>
    accountsEnabled && state.status === "signedIn" ? (state.account?.id ?? null) : null,
  );
  const signedIn = viewerAccountId !== null;
  const showSignIn = useSignInDialog((state) => state.show);
  const buckets = useHubStore((state) => state.topBuckets);
  const bucketsLoaded = useHubStore((state) => state.topBucketsLoaded);
  const snapshot = useHubStore((state) => state.topSnapshot);
  const error = useHubStore((state) => state.topSnapshotError);
  const fetchBuckets = useHubStore((state) => state.fetchTopBuckets);
  const fetchSnapshot = useHubStore((state) => state.fetchTopSnapshot);
  const setFavorite = useHubStore((state) => state.setFavorite);
  const favoritePending = useHubStore((state) => state.favoritePending);
  const [searchParams, setSearchParams] = useSearchParams();
  const bucket = searchParams.get("bucket") ?? DEFAULT_BUCKET;
  const activeBucket =
    buckets.length > 0 && !buckets.some((item) => item.key === bucket) ? buckets[0].key : bucket;

  useEffect(() => {
    void fetchBuckets();
  }, [fetchBuckets]);

  useEffect(() => {
    if (bucketsLoaded) void fetchSnapshot(activeBucket);
  }, [bucketsLoaded, activeBucket, fetchSnapshot, viewerAccountId]);

  function selectBucket(key: string) {
    const next = new URLSearchParams(searchParams);
    if (key === DEFAULT_BUCKET) next.delete("bucket");
    else next.set("bucket", key);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <h2 className="font-serif text-xl font-semibold tracking-tight sm:text-2xl">
              Top Decks
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Curated publications with a complete, playable card snapshot behind every rank.
          </p>
        </div>
        <div
          className={cn(
            "no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1",
            bucketsLoaded && buckets.length === 0 && "hidden",
          )}
        >
          {bucketsLoaded
            ? buckets.map((item) => (
                <Button
                  key={item.key}
                  type="button"
                  variant={activeBucket === item.key ? "secondary" : "ghost"}
                  size="sm"
                  className="shrink-0"
                  aria-pressed={activeBucket === item.key}
                  onClick={() => selectBucket(item.key)}
                >
                  {item.label}
                </Button>
              ))
            : Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="h-8 w-24 shrink-0 animate-pulse rounded-md bg-muted" />
              ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 lg:px-8">
        {error ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-medium">This ranking is unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void fetchSnapshot(activeBucket)}
            >
              Retry
            </Button>
          </div>
        ) : snapshot === null ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : snapshot.entries.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Trophy className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">No snapshot published yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This bucket will appear here after its first ranked snapshot is curated.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {snapshot.entries.map((ranked) => (
              <div key={ranked.entry.id} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="font-serif text-lg font-semibold text-primary">
                    #{ranked.rank}
                  </span>
                  {ranked.reason && (
                    <span className="truncate text-xs text-muted-foreground" title={ranked.reason}>
                      {ranked.reason}
                    </span>
                  )}
                </div>
                <DeckHubEntryCard
                  entry={ranked.entry}
                  onOpen={() => onOpenDeck(ranked.entry.id)}
                  favoritePending={Boolean(favoritePending[ranked.entry.id])}
                  onFavorite={
                    accountsEnabled
                      ? () => {
                          if (!signedIn) {
                            showSignIn();
                            return;
                          }
                          void setFavorite(ranked.entry.id, !ranked.entry.favorited).catch(
                            (error) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Failed to update favorite",
                              ),
                          );
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground sm:px-6 lg:px-8">
        {snapshot?.snapshotDate
          ? `Snapshot dated ${snapshot.snapshotDate}. Rankings do not mutate the underlying decks.`
          : " "}
      </p>
    </div>
  );
}
