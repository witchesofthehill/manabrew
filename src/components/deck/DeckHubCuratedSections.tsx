import { useEffect, useState } from "react";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { fetchDeckHubEntries } from "@/api/hub";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import { availableEngines } from "@/lib/engines";

interface DeckHubCuratedSectionsProps {
  onOpen: (id: string) => void;
}

interface CuratedSectionProps extends DeckHubCuratedSectionsProps {
  title: string;
  description: string;
  entries: DeckHubEntrySummary[];
}

function CuratedSection({ title, description, entries, onOpen }: CuratedSectionProps) {
  if (entries.length === 0) return null;

  return (
    <section>
      <div className="mb-3">
        <h2 className="font-serif text-xl font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {entries.map((entry) => (
          <div key={entry.id} className="w-64 shrink-0 sm:w-72">
            <DeckHubEntryCard entry={entry} onOpen={() => onOpen(entry.id)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DeckHubCuratedSections({ onOpen }: DeckHubCuratedSectionsProps) {
  const [presets, setPresets] = useState<DeckHubEntrySummary[]>([]);
  const [favorites, setFavorites] = useState<DeckHubEntrySummary[]>([]);

  useEffect(() => {
    let active = true;
    const engines = availableEngines();
    void Promise.all([
      fetchDeckHubEntries({ source: "presets", sort: "newest", engines, pageSize: 8 }),
      fetchDeckHubEntries({ source: "all", sort: "favorites", engines, pageSize: 8 }),
    ])
      .then(([presetResult, favoriteResult]) => {
        if (!active) return;
        setPresets(presetResult.entries);
        setFavorites(favoriteResult.entries);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (presets.length === 0 && favorites.length === 0) return null;

  return (
    <div className="space-y-8 pb-9">
      <CuratedSection
        title="Popular with players"
        description="Decks players keep coming back to."
        entries={favorites}
        onOpen={onOpen}
      />
      <CuratedSection
        title="Official presets"
        description="Ready-to-play decks curated by Manabrew."
        entries={presets}
        onOpen={onOpen}
      />
    </div>
  );
}
