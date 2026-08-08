import { useEffect, useState } from "react";
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
import type { TopDeckSnapshotEntry } from "@/api/hubTypes";

const DEFAULT_BUCKET = "trending";
const INITIAL_RANK_COUNT = 10;

interface HubTopDeckSnapshotsProps {
  onOpenDeck: (id: string) => void;
}

function snapshotCaption(key: string, scope: string, snapshotDate: string): string {
  if (scope === "editorial") return `Curated snapshot dated ${snapshotDate}.`;
  if (key === "rising") {
    return `Compared with the previous week using online and offline play through ${snapshotDate}.`;
  }
  if (scope === "online") {
    return `Based on completed online matches from the 30 days ending ${snapshotDate}.`;
  }
  if (scope === "community") {
    return `Based on recent Community activity through ${snapshotDate}.`;
  }
  return `Based on online and offline play from the 30 days ending ${snapshotDate}.`;
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
  const [showAllBucket, setShowAllBucket] = useState<string | null>(null);
  const visibleBuckets = buckets.filter((item) => item.entryCount > 0);
  const bucket = searchParams.get("bucket") ?? DEFAULT_BUCKET;
  const activeBucket =
    visibleBuckets.length > 0 && !visibleBuckets.some((item) => item.key === bucket)
      ? visibleBuckets[0].key
      : bucket;
  const showAll = showAllBucket === activeBucket;

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

  const displayedEntries = snapshot
    ? showAll
      ? snapshot.entries
      : snapshot.entries.slice(0, INITIAL_RANK_COUNT)
    : [];
  const podiumEntries = displayedEntries.slice(0, 3);
  const remainingEntries = displayedEntries.slice(3);

  function favorite(ranked: TopDeckSnapshotEntry) {
    if (!signedIn) {
      showSignIn();
      return;
    }
    void setFavorite(ranked.entry.id, !ranked.entry.favorited).catch((error) =>
      toast.error(error instanceof Error ? error.message : "Failed to update favorite"),
    );
  }

  function rankedDeck(ranked: TopDeckSnapshotEntry, podium = false) {
    return (
      <div className="relative pl-2 pt-2">
        <span
          className={cn(
            "absolute left-0 top-0 z-30 rounded-full border border-primary/30 bg-background/95 px-2 py-0.5 font-serif font-semibold text-primary shadow-sm",
            podium && ranked.rank === 1 ? "text-xl" : "text-sm",
          )}
        >
          #{ranked.rank}
        </span>
        <DeckHubEntryCard
          entry={ranked.entry}
          onOpen={() => onOpenDeck(ranked.entry.id)}
          favoritePending={Boolean(favoritePending[ranked.entry.id])}
          onFavorite={accountsEnabled ? () => favorite(ranked) : undefined}
        />
        {ranked.reason && (
          <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground" title={ranked.reason}>
            {ranked.reason}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b px-4 py-2 sm:px-6 lg:px-8">
        <div
          className={cn(
            "no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1",
            bucketsLoaded && visibleBuckets.length === 0 && "hidden",
          )}
        >
          {bucketsLoaded
            ? visibleBuckets.map((item) => (
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
              This ranking appears after its first evidence-backed snapshot is available.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-12 gap-4">
              {podiumEntries.map((ranked, index) => (
                <div
                  key={ranked.entry.id}
                  className={cn(
                    index === 0 && "col-span-12 md:col-span-7 md:row-span-2",
                    index === 1 && "col-span-10 md:col-span-5",
                    index === 2 && "col-span-8 col-start-5 md:col-span-4 md:col-start-9",
                  )}
                >
                  {rankedDeck(ranked, true)}
                </div>
              ))}
            </div>
            {remainingEntries.length > 0 && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {remainingEntries.map((ranked) => (
                  <div key={ranked.entry.id}>{rankedDeck(ranked)}</div>
                ))}
              </div>
            )}
            {!showAll && snapshot.entries.length > INITIAL_RANK_COUNT && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" size="sm" onClick={() => setShowAllBucket(activeBucket)}>
                  Show all {snapshot.entries.length} ranked decks
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground sm:px-6 lg:px-8">
        {snapshot?.snapshotDate
          ? snapshotCaption(snapshot.bucket.key, snapshot.bucket.scope, snapshot.snapshotDate)
          : " "}
      </p>
    </div>
  );
}
