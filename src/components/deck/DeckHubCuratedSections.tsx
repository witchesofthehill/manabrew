import { useEffect, useState } from "react";
import { Flame, Sparkles } from "lucide-react";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { DeckHubTopDeckPreview } from "@/components/deck/DeckHubTopDeckPreview";
import { fetchDeckHubEntries } from "@/api/hub";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import { availableEngines } from "@/lib/engines";

interface DeckHubCuratedSectionsProps {
  onOpen: (id: string) => void;
  onAuthor: (author: string) => void;
}

function SectionHeading({ title }: { title: string }) {
  return <h2 className="mb-3 font-serif text-xl font-semibold">{title}</h2>;
}

export function DeckHubCuratedSections({ onOpen, onAuthor }: DeckHubCuratedSectionsProps) {
  const [presets, setPresets] = useState<DeckHubEntrySummary[]>([]);
  const [popular, setPopular] = useState<DeckHubEntrySummary[]>([]);
  const [newest, setNewest] = useState<DeckHubEntrySummary[]>([]);

  useEffect(() => {
    let active = true;
    const engines = availableEngines();
    void Promise.all([
      fetchDeckHubEntries({ source: "presets", sort: "newest", engines, pageSize: 10 }),
      fetchDeckHubEntries({ source: "all", sort: "favorites", engines, pageSize: 5 }),
      fetchDeckHubEntries({ source: "all", sort: "newest", engines, pageSize: 6 }),
    ])
      .then(([presetResult, popularResult, newestResult]) => {
        if (!active) return;
        setPresets(presetResult.entries);
        setPopular(popularResult.entries);
        setNewest(newestResult.entries);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (presets.length === 0 && popular.length === 0 && newest.length === 0) return null;

  return (
    <div className="space-y-10 pb-10">
      <DeckHubTopDeckPreview onOpen={onOpen} onAuthor={onAuthor} />

      {popular.length > 0 && (
        <section className="rounded-2xl border border-border/70 bg-muted/20 p-3 sm:p-4">
          <SectionHeading title="Most favorited" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {popular.map((entry, index) => (
              <div key={entry.id} className={index === 0 ? "col-span-2 row-span-2" : ""}>
                <DeckHubEntryCard
                  entry={entry}
                  onOpen={() => onOpen(entry.id)}
                  onAuthorClick={() => onAuthor(entry.author)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {newest.length > 0 && (
        <section>
          <SectionHeading title="Fresh brews" />
          <div className="grid gap-3 xl:grid-cols-2">
            {newest.map((entry) => (
              <DeckHubEntryCard
                key={entry.id}
                entry={entry}
                variant="list"
                onOpen={() => onOpen(entry.id)}
                onAuthorClick={() => onAuthor(entry.author)}
              />
            ))}
          </div>
        </section>
      )}

      {presets.length > 0 && (
        <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-primary/5 py-4">
          <Flame className="pointer-events-none absolute -right-5 -top-8 h-32 w-32 rotate-12 text-primary/5" />
          <div className="px-4">
            <SectionHeading title="Pick up & play" />
          </div>
          <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
            {presets.map((entry, index) => (
              <div
                key={entry.id}
                className="w-64 shrink-0 snap-start sm:w-72"
                style={{ transform: `rotate(${index % 2 === 0 ? "-0.35deg" : "0.35deg"})` }}
              >
                <DeckHubEntryCard
                  entry={entry}
                  onOpen={() => onOpen(entry.id)}
                  onAuthorClick={() => onAuthor(entry.author)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-3 py-1 text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
