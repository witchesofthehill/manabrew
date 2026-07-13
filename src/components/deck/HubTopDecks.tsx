import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TopDecksWindow } from "@/api/hub";
import { useHubStore } from "@/stores/useHubStore";
import { cn } from "@/lib/utils";

const TOP_WINDOWS: { value: TopDecksWindow; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export function HubTopDecks() {
  const [window, setWindow] = useState<TopDecksWindow>("30d");
  const topDecks = useHubStore((s) => s.topDecks);
  const topError = useHubStore((s) => s.topError);
  const fetchTop = useHubStore((s) => s.fetchTop);

  useEffect(() => {
    void fetchTop(window);
  }, [fetchTop, window]);

  return (
    <>
      <div className="flex items-center gap-1">
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
      <div className="flex-1 min-h-0 overflow-y-auto">
        {topError ? (
          <p className="text-sm text-destructive">{topError}</p>
        ) : topDecks === null ? (
          <p className="text-sm text-muted-foreground">Loading top decks…</p>
        ) : topDecks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No games recorded in this window.</p>
        ) : (
          <ol className="space-y-1 max-w-2xl">
            {topDecks.map((stat, index) => (
              <li
                key={`${stat.deckName}-${stat.commander ?? ""}`}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2",
                  index === 0 && "border-primary",
                )}
              >
                <span className="text-sm font-bold text-muted-foreground w-6 text-right shrink-0">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{stat.deckName}</p>
                  {stat.commander && (
                    <p className="text-xs text-muted-foreground truncate">{stat.commander}</p>
                  )}
                </div>
                <span className="text-sm text-muted-foreground shrink-0">
                  {stat.plays} {stat.plays === 1 ? "game" : "games"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Most-played decks across online games. Win rates arrive once winner tracking is fixed for
        hosted games.
      </p>
    </>
  );
}
