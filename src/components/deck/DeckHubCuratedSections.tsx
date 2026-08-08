import { useEffect, useState } from "react";
import { Flame, Sparkles } from "lucide-react";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { fetchDeckHubEntries } from "@/api/hub";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import { availableEngines } from "@/lib/engines";

interface DeckHubCuratedSectionsProps {
  onOpen: (id: string) => void;
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
        {eyebrow}
      </p>
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function DeckHubCuratedSections({ onOpen }: DeckHubCuratedSectionsProps) {
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
      {popular.length > 0 && (
        <section className="rounded-2xl border border-border/70 bg-muted/20 p-3 sm:p-4">
          <SectionHeading
            eyebrow="Crowd magic"
            title="Decks with main-character energy"
            description="Big favorites up front, delightful oddballs around the edges."
          />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {popular.map((entry, index) => (
              <div key={entry.id} className={index === 0 ? "col-span-2 row-span-2" : ""}>
                <DeckHubEntryCard entry={entry} onOpen={() => onOpen(entry.id)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {newest.length > 0 && (
        <section>
          <SectionHeading
            eyebrow="Just brewed"
            title="Still warm from the deck editor"
            description="The newest ideas, served in quick sips."
          />
          <ol className="grid gap-2 md:grid-cols-2">
            {newest.map((entry, index) => (
              <li key={entry.id} className="flex min-w-0 items-center gap-3">
                <span className="w-6 shrink-0 text-center font-serif text-xl text-muted-foreground/60">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <DeckHubEntryCard
                    entry={entry}
                    variant="compact"
                    onOpen={() => onOpen(entry.id)}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {presets.length > 0 && (
        <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-primary/5 py-4">
          <Flame className="pointer-events-none absolute -right-5 -top-8 h-32 w-32 rotate-12 text-primary/5" />
          <div className="px-4">
            <SectionHeading
              eyebrow="Ready when you are"
              title="Grab a deck and cause a little trouble"
              description="Official presets made for immediate experimentation."
            />
          </div>
          <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
            {presets.map((entry, index) => (
              <div
                key={entry.id}
                className="w-64 shrink-0 snap-start sm:w-72"
                style={{ transform: `rotate(${index % 2 === 0 ? "-0.35deg" : "0.35deg"})` }}
              >
                <DeckHubEntryCard entry={entry} onOpen={() => onOpen(entry.id)} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-3 py-1 text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Endless aisle</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
