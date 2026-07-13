import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TopDecksWindow } from "@/api/hub";
import { useHubStore } from "@/stores/useHubStore";
import { chooseImageUrisForCard, useCard } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";
import type { TopDeckStat } from "@/api/hubTypes";

const TOP_WINDOWS: { value: TopDecksWindow; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

function TopDeckRow({
  stat,
  rank,
  onOpen,
}: {
  stat: TopDeckStat;
  rank: number;
  onOpen: () => void;
}) {
  const card = useCard({ name: stat.commander ?? stat.deckName });
  const art = card ? chooseImageUrisForCard(card.info, { frontOnly: true })?.art_crop : undefined;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "w-full flex items-center gap-3 rounded-md border px-3 py-2 text-left",
          "transition-all hover:ring-2 hover:ring-primary hover:border-primary cursor-pointer",
          rank === 1 && "border-primary",
        )}
      >
        <span className="text-sm font-bold text-muted-foreground w-6 text-right shrink-0">
          {rank}
        </span>
        <div className="h-12 w-20 shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center">
          {art ? (
            <img
              src={art}
              alt={stat.commander ?? stat.deckName}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <Layers className="h-5 w-5 text-muted-foreground opacity-40" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{stat.deckName}</p>
          {stat.commander && stat.commander !== stat.deckName && (
            <p className="text-xs text-muted-foreground truncate">{stat.commander}</p>
          )}
        </div>
        <span className="text-sm text-muted-foreground shrink-0">
          {stat.plays} {stat.plays === 1 ? "game" : "games"}
        </span>
      </button>
    </li>
  );
}

export function HubTopDecks({ onSearchDeck }: { onSearchDeck?: (name: string) => void }) {
  const [window, setWindow] = useState<TopDecksWindow>("30d");
  const topDecks = useHubStore((s) => s.topDecks);
  const topError = useHubStore((s) => s.topError);
  const fetchTop = useHubStore((s) => s.fetchTop);

  useEffect(() => {
    void fetchTop(window);
  }, [fetchTop, window]);

  return (
    <>
      <div className="mt-2 flex items-center gap-1 px-2 py-1.5 shrink-0">
        {TOP_WINDOWS.map((w) => (
          <Button
            key={w.value}
            variant={window === w.value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setWindow(w.value)}
          >
            {w.label}
          </Button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {topError ? (
          <p className="text-sm text-destructive">{topError}</p>
        ) : topDecks === null ? (
          <p className="text-sm text-muted-foreground">Loading top decks…</p>
        ) : topDecks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No games recorded in this window.</p>
        ) : (
          <ol className="space-y-1 max-w-2xl">
            {topDecks.map((stat, index) => (
              <TopDeckRow
                key={`${stat.deckName}-${stat.commander ?? ""}`}
                stat={stat}
                rank={index + 1}
                onOpen={() => onSearchDeck?.(stat.deckName)}
              />
            ))}
          </ol>
        )}
      </div>
      <p className="text-xs text-muted-foreground px-4 py-2 border-t shrink-0">
        Most-played decks across online games — click one to search for it in the hub. Win rates
        arrive once winner tracking is fixed for hosted games.
      </p>
    </>
  );
}
