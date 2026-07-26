import { useEffect, useState } from "react";
import { BarChart3, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TopDecksWindow } from "@/api/hub";
import { useHubStore } from "@/stores/useHubStore";
import { cn } from "@/lib/utils";
import { HubTopDeckEntry } from "@/components/deck/HubTopDeckEntry";

const TOP_WINDOWS: { value: TopDecksWindow; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All time" },
];

const WINDOW_COPY: Record<TopDecksWindow, string> = {
  "7d": "the last seven days",
  "30d": "the last thirty days",
  all: "all recorded games",
};

export function HubTopDecks({ onSearchDeck }: { onSearchDeck?: (name: string) => void }) {
  const [window, setWindow] = useState<TopDecksWindow>("30d");
  const topDecks = useHubStore((s) => s.topDecks);
  const topError = useHubStore((s) => s.topError);
  const fetchTop = useHubStore((s) => s.fetchTop);

  useEffect(() => {
    void fetchTop(window);
  }, [fetchTop, window]);

  const displayedPlays = topDecks?.reduce((total, stat) => total + stat.plays, 0) ?? 0;
  const maxPlays = topDecks?.[0]?.plays ?? 0;
  const featured = topDecks?.slice(0, 3) ?? [];
  const rankings = topDecks?.slice(3) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <h2 className="font-serif text-xl font-semibold tracking-tight sm:text-2xl">
              Most Played
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Decks seen most often across official public-relay games in {WINDOW_COPY[window]}.
          </p>
        </div>
        <div
          role="group"
          aria-label="Leaderboard time period"
          className="flex w-fit items-center rounded-lg border bg-muted/40 p-1"
        >
          {TOP_WINDOWS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setWindow(item.value)}
              aria-pressed={window === item.value}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors pointer-coarse:min-h-10 pointer-coarse:px-4",
                window === item.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        {topError ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <BarChart3 className="h-8 w-8 text-destructive" />
            <p className="mt-3 text-sm font-medium">Leaderboard unavailable</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{topError}</p>
            <Button
              className="mt-4"
              variant="outline"
              size="sm"
              onClick={() => void fetchTop(window)}
            >
              Try again
            </Button>
          </div>
        ) : topDecks === null ? (
          <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
            Building the leaderboard…
          </div>
        ) : topDecks.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <Trophy className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">No games in this window</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a wider time range to see which decks players bring most often.
            </p>
            {window !== "all" && (
              <Button className="mt-4" variant="outline" size="sm" onClick={() => setWindow("all")}>
                View all time
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Leaders
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {displayedPlays.toLocaleString()} plays across the {topDecks.length} listed decks
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Select a deck to search published copies
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {featured.map((stat, index) => (
                <HubTopDeckEntry
                  key={`${stat.deckName}-${stat.commander ?? ""}`}
                  stat={stat}
                  rank={index + 1}
                  maxPlays={maxPlays}
                  displayedPlays={displayedPlays}
                  featured
                  onOpen={() => onSearchDeck?.(stat.deckName)}
                />
              ))}
            </div>

            {rankings.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between gap-3 border-b pb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    The Field
                  </h3>
                  <span className="text-[10px] text-muted-foreground">Relative to #1</span>
                </div>
                <ol className="space-y-0.5">
                  {rankings.map((stat, index) => (
                    <HubTopDeckEntry
                      key={`${stat.deckName}-${stat.commander ?? ""}`}
                      stat={stat}
                      rank={index + 4}
                      maxPlays={maxPlays}
                      displayedPlays={displayedPlays}
                      onOpen={() => onSearchDeck?.(stat.deckName)}
                    />
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </div>
      <p className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground sm:px-6 lg:px-8">
        Rankings measure play frequency, not win rate. Selecting a name searches for a published
        copy; some played decks may not be available in the Hub.
      </p>
    </div>
  );
}
