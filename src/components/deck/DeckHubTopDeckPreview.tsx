import { useEffect } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { DeckHubPodiumFrame } from "@/components/deck/DeckHubPodiumFrame";
import { ROUTES } from "@/lib/constants";
import { useHubStore } from "@/stores/useHubStore";

interface DeckHubTopDeckPreviewProps {
  onOpen: (id: string) => void;
  onAuthor: (author: string) => void;
}

export function DeckHubTopDeckPreview({ onOpen, onAuthor }: DeckHubTopDeckPreviewProps) {
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-xl font-semibold">Top decks right now</h2>
        </div>
        <Link
          to={ROUTES.HUB_TOP}
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          See rankings
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {entries.length > 0 ? (
        <div className="grid grid-cols-12 gap-3 md:aspect-[12/5] md:grid-rows-3">
          {entries.map((ranked, index) => (
            <div
              key={ranked.entry.id}
              className={
                index === 0
                  ? "col-span-12 md:col-span-7 md:row-span-3"
                  : index === 1
                    ? "col-span-7 row-start-2 md:col-span-5 md:col-start-8 md:row-span-2 md:row-start-1"
                    : "col-span-5 col-start-1 row-start-3 md:col-span-5 md:col-start-8 md:row-start-3"
              }
            >
              <DeckHubPodiumFrame rank={ranked.rank} className="flex h-full min-h-0 flex-col">
                <DeckHubEntryCard
                  entry={ranked.entry}
                  rank={ranked.rank}
                  reason={ranked.reason}
                  variant="stage"
                  onOpen={() => onOpen(ranked.entry.id)}
                  onAuthorClick={() => onAuthor(ranked.entry.author)}
                />
              </DeckHubPodiumFrame>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3 md:aspect-[12/5] md:grid-rows-3">
          <div className="col-span-12 aspect-[4/3] animate-pulse rounded-lg bg-muted md:col-span-7 md:row-span-3 md:aspect-auto" />
          <div className="col-span-7 aspect-[4/3] animate-pulse rounded-lg bg-muted md:col-span-5 md:col-start-8 md:row-span-2 md:row-start-1 md:aspect-auto" />
          <div className="col-span-5 aspect-[4/3] animate-pulse rounded-lg bg-muted md:col-span-5 md:col-start-8 md:row-start-3 md:aspect-auto" />
        </div>
      )}
    </section>
  );
}
