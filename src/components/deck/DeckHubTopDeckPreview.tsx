import { useEffect } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { ROUTES } from "@/lib/constants";
import { useHubStore } from "@/stores/useHubStore";

interface DeckHubTopDeckPreviewProps {
  onOpen: (id: string) => void;
}

export function DeckHubTopDeckPreview({ onOpen }: DeckHubTopDeckPreviewProps) {
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
        <div className="grid grid-cols-12 items-start gap-3">
          {entries.map((ranked, index) => (
            <div
              key={ranked.entry.id}
              className={
                index === 0
                  ? "col-span-12 md:col-span-6"
                  : index === 1
                    ? "col-span-9 md:col-span-4"
                    : "col-span-7 col-start-6 md:col-span-2 md:col-start-auto"
              }
            >
              <div className="relative pt-8">
                <span className="absolute left-0 top-0 z-30 rounded-full border border-primary/30 bg-background/95 px-2 py-0.5 font-serif text-sm font-semibold text-primary shadow-sm">
                  #{ranked.rank}
                </span>
                <DeckHubEntryCard entry={ranked.entry} onOpen={() => onOpen(ranked.entry.id)} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}
    </section>
  );
}
