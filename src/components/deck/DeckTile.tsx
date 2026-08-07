import type { ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckTileFace } from "@/components/deck/DeckTileFace";

interface DeckTileProps {
  title: string;
  titleClassName?: string;
  subtitle?: string;
  openLabel: string;
  coverUrl?: string;
  coverAlt?: string;
  formatId: string;
  colorCost?: string;
  cardCount: number;
  badges?: ReactNode;
  actions?: ReactNode;
  onOpen: () => void;
  onPlay?: () => void;
  playLabel?: string;
  playing?: boolean;
  playDisabled?: boolean;
}

export function DeckTile({
  title,
  titleClassName,
  subtitle,
  openLabel,
  coverUrl,
  coverAlt,
  formatId,
  colorCost,
  cardCount,
  badges,
  actions,
  onOpen,
  onPlay,
  playLabel,
  playing = false,
  playDisabled = false,
}: DeckTileProps) {
  return (
    <div className="group relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted transition-all hover:border-primary hover:ring-2 hover:ring-primary">
      <button
        type="button"
        className="absolute inset-0 w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={openLabel}
        onClick={onOpen}
      >
        <DeckTileFace
          title={title}
          titleClassName={titleClassName}
          subtitle={subtitle}
          coverUrl={coverUrl}
          coverAlt={coverAlt}
          formatId={formatId}
          colorCost={colorCost}
          cardCount={cardCount}
          badges={badges}
        />
      </button>

      {onPlay && (
        <Button
          size="sm"
          variant="secondary"
          disabled={playing || playDisabled}
          aria-label={playLabel}
          className="absolute left-1.5 top-1.5 z-20 h-8 bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
          onClick={onPlay}
        >
          {playing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {playing ? "Starting…" : "Play"}
        </Button>
      )}

      {actions && (
        <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1">{actions}</div>
      )}
    </div>
  );
}
