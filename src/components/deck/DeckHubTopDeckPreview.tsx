import { useEffect } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { DeckHubPodiumFrame } from "@/components/deck/DeckHubPodiumFrame";
import { ROUTES } from "@/lib/constants";
import { useHubStore } from "@/stores/useHubStore";
import { useIsTouch } from "@/hooks/useBreakpoints";
interface DeckHubTopDeckPreviewProps {
  onOpen: (id: string) => void;
  onAuthor: (author: string) => void;
}
export function DeckHubTopDeckPreview({ onOpen, onAuthor }: DeckHubTopDeckPreviewProps) {
  const isTouch = useIsTouch();
  const buckets = useHubStore((state) => state.topBuckets);
  const bucketsLoaded = useHubStore((state) => state.topBucketsLoaded);
  const snapshot = useHubStore((state) => state.topSnapshot);
  const fetchBuckets = useHubStore((state) => state.fetchTopBuckets);
  const fetchSnapshot = useHubStore((state) => state.fetchTopSnapshot);
  const previewBucket =
    buckets.find((bucket) => bucket.key === "trending" && bucket.entryCount > 0) ??
    buckets.find((bucket) => bucket.entryCount > 0);
  useEffect(() => {
    void fetchBuckets();
  }, [fetchBuckets]);
  useEffect(() => {
    if (!bucketsLoaded || !previewBucket || snapshot?.bucket.key === previewBucket.key) return;
    void fetchSnapshot(previewBucket.key);
  }, [bucketsLoaded, fetchSnapshot, previewBucket, snapshot?.bucket.key]);
  const entries =
    snapshot && snapshot.bucket.key === previewBucket?.key ? snapshot.entries.slice(0, 3) : [];
  if (bucketsLoaded && !previewBucket) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-xl font-semibold">Top decks right now</h2>
        </div>
        <Link
          to={ROUTES.HUB_TOP}
          className="flex min-h-8 shrink-0 items-center gap-1 text-ui-label font-medium text-primary hover:underline touch:min-h-11 touch:min-w-11"
        >
          See rankings
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {entries.length > 0 ? (
        isTouch ? (
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 pr-8 no-scrollbar touch-scroll-fade">
            {entries.map((ranked) => (
              <div key={ranked.entry.id} className="w-[78vw] max-w-72 shrink-0 snap-start">
                <DeckHubPodiumFrame rank={ranked.rank}>
                  <DeckHubEntryCard
                    entry={ranked.entry}
                    rank={ranked.rank}
                    reason={ranked.reason}
                    onOpen={() => onOpen(ranked.entry.id)}
                    onAuthorClick={onAuthor}
                  />
                </DeckHubPodiumFrame>
              </div>
            ))}
          </div>
        ) : (
          <div className="@container grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
            {entries.map((ranked, index) => (
              <div
                key={ranked.entry.id}
                className={index === 0 ? "@min-[52rem]:col-span-2 @min-[52rem]:row-span-2" : ""}
              >
                <DeckHubPodiumFrame rank={ranked.rank} className="flex h-full min-h-0 flex-col">
                  <DeckHubEntryCard
                    entry={ranked.entry}
                    rank={ranked.rank}
                    reason={ranked.reason}
                    variant="stage"
                    onOpen={() => onOpen(ranked.entry.id)}
                    onAuthorClick={onAuthor}
                  />
                </DeckHubPodiumFrame>
              </div>
            ))}
          </div>
        )
      ) : isTouch ? (
        <div className="-mx-1 flex gap-3 overflow-hidden px-1">
          {Array.from({ length: 2 }, (_, index) => (
            <div
              key={index}
              className="aspect-[4/3] w-[78vw] max-w-72 shrink-0 animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      ) : (
        <div className="@container grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-muted @min-[52rem]:col-span-2 @min-[52rem]:row-span-2" />
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
        </div>
      )}
    </section>
  );
}
