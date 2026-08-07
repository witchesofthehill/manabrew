import type { ReactNode } from "react";
import { Layers } from "lucide-react";
import { ScryfallImg } from "@/components/ScryfallImg";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DECK_NAME_SHADOW_CLASS } from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";

export const DECK_TILE_PILL_CLASS =
  "rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-[9px] font-medium text-foreground backdrop-blur-sm";

interface DeckTileFaceProps {
  title: string;
  titleClassName?: string;
  subtitle?: string;
  coverUrl?: string;
  coverAlt?: string;
  formatId?: string;
  colorCost?: string;
  cardCount?: number;
  badges?: ReactNode;
  footnote?: string;
  footnoteClassName?: string;
  dense?: boolean;
}

export function DeckTileFace({
  title,
  titleClassName,
  subtitle,
  coverUrl,
  coverAlt,
  formatId,
  colorCost,
  cardCount,
  badges,
  footnote,
  footnoteClassName,
  dense = false,
}: DeckTileFaceProps) {
  return (
    <>
      {coverUrl ? (
        <ScryfallImg
          src={coverUrl}
          alt={coverAlt ?? ""}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-110"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <Layers className="h-10 w-10 text-muted-foreground opacity-30" />
        </span>
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-overlay/80 via-overlay/20 to-overlay/10" />
      <span
        className={cn(
          "absolute bottom-0 left-0 right-0 z-10 block px-2",
          dense ? "pb-1.5 pt-4" : "pb-2 pt-6",
        )}
      >
        <span
          className={cn(
            "block truncate text-sm font-semibold leading-tight text-text-on-tinted",
            titleClassName,
            DECK_NAME_SHADOW_CLASS,
          )}
        >
          {title}
        </span>
        {subtitle && (
          <span
            className={cn(
              "block truncate text-[11px] text-text-on-tinted/85",
              DECK_NAME_SHADOW_CLASS,
            )}
          >
            {subtitle}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {formatId && <FormatBadge formatId={formatId} />}
          {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
          {badges}
          {cardCount !== undefined && (
            <span className="ml-auto text-[10px] text-text-on-tinted/85">{cardCount} cards</span>
          )}
        </span>
        {footnote && (
          <span
            className={cn(
              "mt-1 block truncate text-[11px] leading-tight text-text-on-tinted/85",
              DECK_NAME_SHADOW_CLASS,
              footnoteClassName,
            )}
          >
            {footnote}
          </span>
        )}
      </span>
    </>
  );
}
