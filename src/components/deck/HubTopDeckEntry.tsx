import { ArrowUpRight, Layers } from "lucide-react";
import { ScryfallImg } from "@/components/ScryfallImg";
import { chooseImageUrisForCard, useCard } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";
import type { TopDeckStat } from "@/api/hubTypes";

interface HubTopDeckEntryProps {
  stat: TopDeckStat;
  rank: number;
  maxPlays: number;
  displayedPlays: number;
  featured?: boolean;
  onOpen: () => void;
}

function lastPlayedLabel(value?: string): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return "Played today";
  if (days === 1) return "Played yesterday";
  if (days < 30) return `Played ${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Played ${months}mo ago`;
  return `Played ${Math.floor(months / 12)}y ago`;
}

export function HubTopDeckEntry({
  stat,
  rank,
  maxPlays,
  displayedPlays,
  featured = false,
  onOpen,
}: HubTopDeckEntryProps) {
  const card = useCard(stat.commander ? { name: stat.commander } : null);
  const art = card ? chooseImageUrisForCard(card.info, { frontOnly: true })?.art_crop : undefined;
  const share = displayedPlays > 0 ? (stat.plays / displayedPlays) * 100 : 0;
  const relativeWidth = maxPlays > 0 ? Math.max(4, (stat.plays / maxPlays) * 100) : 0;
  const lastPlayed = lastPlayedLabel(stat.lastPlayed);

  if (featured) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group relative isolate min-h-44 overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all",
          "hover:-translate-y-0.5 hover:border-primary hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          rank === 1 && "border-primary/60 shadow-md",
        )}
        aria-label={`Rank ${rank}: ${stat.deckName}, ${stat.plays} plays. Search published decks.`}
      >
        {art ? (
          <ScryfallImg
            src={art}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-muted">
            <Layers className="h-10 w-10 text-muted-foreground/40" />
          </span>
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-overlay via-overlay/65 to-overlay/10" />
        <span className="relative z-10 flex h-full min-h-44 flex-col justify-between p-4">
          <span className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "flex h-9 min-w-9 items-center justify-center rounded-full border bg-background/90 px-2 font-serif text-lg font-semibold shadow-sm backdrop-blur-sm",
                rank === 1 ? "border-primary text-primary" : "border-border text-foreground",
              )}
            >
              {rank}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100">
              Search Hub
              <ArrowUpRight className="h-3 w-3" />
            </span>
          </span>
          <span>
            <span className="block font-serif text-xl font-semibold leading-tight text-text-on-tinted drop-shadow-sm sm:text-2xl">
              {stat.deckName}
            </span>
            {stat.commander && stat.commander !== stat.deckName && (
              <span className="mt-1 block truncate text-xs text-text-on-tinted/80">
                {stat.commander}
              </span>
            )}
            <span className="mt-3 flex items-end justify-between gap-3 text-text-on-tinted">
              <span>
                <span className="text-2xl font-semibold tabular-nums">{stat.plays}</span>
                <span className="ml-1 text-xs text-text-on-tinted/75">
                  {stat.plays === 1 ? "play" : "plays"}
                </span>
              </span>
              <span className="text-right text-[11px] text-text-on-tinted/75">
                <span className="block font-semibold text-text-on-tinted">
                  {share.toFixed(1)}% of shown plays
                </span>
                {lastPlayed}
              </span>
            </span>
          </span>
        </span>
      </button>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full grid-cols-[2rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[2rem_4.5rem_minmax(0,1fr)_minmax(7rem,12rem)_auto] sm:px-3"
        aria-label={`Rank ${rank}: ${stat.deckName}, ${stat.plays} plays. Search published decks.`}
      >
        <span className="text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground">
          {rank}
        </span>
        <span className="flex h-11 overflow-hidden rounded-md bg-muted sm:h-12">
          {art ? (
            <ScryfallImg src={art} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <Layers className="m-auto h-4 w-4 text-muted-foreground/40" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{stat.deckName}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {stat.commander && stat.commander !== stat.deckName
              ? stat.commander
              : (lastPlayed ?? "Recently played")}
          </span>
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${relativeWidth}%` }}
            />
          </span>
          <span className="mt-1 block text-[10px] text-muted-foreground">
            {share.toFixed(1)}% of shown plays
          </span>
        </span>
        <span className="flex items-center gap-2 pl-1">
          <span className="text-right">
            <span className="block text-sm font-semibold tabular-nums">{stat.plays}</span>
            <span className="block text-[10px] text-muted-foreground">plays</span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
        </span>
      </button>
    </li>
  );
}
