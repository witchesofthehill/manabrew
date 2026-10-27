import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isLand } from "@/lib/mana";
import type { DeckCard } from "@/protocol/deck";
import { CMC_BUCKET_LABELS, cmcBucketIndex } from "./deckBuilder.utils";
import { EDITOR_PANEL_CLASS } from "./deckEditor.styles";
// CMC 1–7+ bucket bars — cool→warm progression using theme counter / signal
// tokens so the curve retones with the active preset.
const BUCKET_BARS = [
  "bg-pt-buffed", // green
  "bg-counter-storage", // teal
  "bg-counter-study", // cyan
  "bg-counter-charge", // purple
  "bg-warning", // amber
  "bg-counter-level", // orange
  "bg-pt-lethal", // red
];
const BAR_MAX_PX = 140;
const TOOLTIP_MAX_NAMES = 10;
interface DeckStatsProps {
  cards: DeckCard[];
  compact?: boolean;
  showHeader?: boolean;
  activeBucket?: number | null;
  onBucketClick?: (bucket: number | null) => void;
}
export function DeckStats({
  cards,
  compact = false,
  showHeader = true,
  activeBucket = null,
  onBucketClick,
}: DeckStatsProps) {
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);
  const barMaxPx = compact ? BAR_MAX_PX / 2 : BAR_MAX_PX;
  const lands: DeckCard[] = [];
  const unknown: DeckCard[] = [];
  const spells: {
    card: DeckCard;
    bucket: number;
  }[] = [];
  for (const card of cards) {
    if (isLand(card.types)) {
      lands.push(card);
      continue;
    }
    const bucket = cmcBucketIndex(card);
    if (bucket === null) unknown.push(card);
    else spells.push({ card, bucket });
  }
  const bucketCards: Map<string, number>[] = Array.from({ length: 7 }, () => new Map());
  for (const { card, bucket } of spells) {
    bucketCards[bucket].set(
      card.identity.name,
      (bucketCards[bucket].get(card.identity.name) ?? 0) + 1,
    );
  }
  const counts = bucketCards.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const max = Math.max(...counts, 1);
  const hasAnything = spells.length > 0;
  return (
    <section className={cn(EDITOR_PANEL_CLASS, compact && "px-3 py-3 sm:px-3")}>
      <div className={cn("flex flex-wrap items-baseline gap-2.5", compact ? "mb-3" : "mb-5")}>
        {showHeader && <h3 className="text-ui-label font-semibold">Mana Curve</h3>}
        <span className="text-ui-meta text-muted-foreground/70">
          {spells.length} spells &middot; {lands.length} lands
        </span>
        {unknown.length > 0 && (
          <span className="text-ui-meta text-warning" title={`CMC unknown`}>
            {unknown.length} ?
          </span>
        )}
      </div>

      {hasAnything ? (
        <div className="overflow-x-auto">
          <div className="touch:min-w-[22rem]">
            <div className="flex gap-1.5 mb-1">
              {counts.map((count, i) => (
                <div key={i} className="flex-1 text-center">
                  <span
                    className={cn(
                      "text-ui-meta font-mono tabular-nums transition-colors",
                      count === 0 && "text-transparent select-none",
                      count > 0 && (hoveredBucket === i ? "text-foreground" : "text-foreground/80"),
                    )}
                  >
                    {count}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-end gap-1.5" style={{ height: barMaxPx }}>
              {counts.map((count, i) => {
                const entries = [...bucketCards[i].entries()].sort(
                  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
                );
                const isActive = activeBucket === i;
                const isDimmed =
                  count > 0 &&
                  !isActive &&
                  ((hoveredBucket !== null && hoveredBucket !== i) ||
                    (hoveredBucket === null && activeBucket !== null));
                return (
                  <Tooltip key={i} open={hoveredBucket === i}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="relative flex h-full min-w-0 touch:min-h-11 touch:min-w-11 flex-1 items-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={!onBucketClick || (count === 0 && !isActive)}
                        aria-label={`${CMC_BUCKET_LABELS[i]} mana: ${count} cards`}
                        aria-pressed={isActive}
                        onMouseEnter={() => setHoveredBucket(count > 0 ? i : null)}
                        onMouseLeave={() => setHoveredBucket(null)}
                        onFocus={() => setHoveredBucket(count > 0 ? i : null)}
                        onBlur={() => setHoveredBucket(null)}
                        onClick={() => onBucketClick?.(isActive ? null : i)}
                      >
                        <div
                          className={cn(
                            "w-full rounded-t-md transition-all duration-200",
                            BUCKET_BARS[i],
                            count === 0 && "opacity-15",
                            isDimmed && "opacity-40",
                            hoveredBucket === i && "brightness-110",
                            isActive &&
                              "ring-2 ring-selection-border ring-offset-2 ring-offset-card",
                          )}
                          style={{
                            height:
                              count > 0 ? `${Math.max((count / max) * barMaxPx, 4)}px` : "4px",
                          }}
                        />
                      </button>
                    </TooltipTrigger>
                    {hoveredBucket === i && (
                      <TooltipContent
                        side="top"
                        className="z-20 w-max max-w-[min(20rem,calc(100vw-2rem))] max-h-[70dvh] overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-xl"
                      >
                        <p className="mb-1.5 text-ui-meta font-semibold">
                          {count} card{count === 1 ? "" : "s"} at {CMC_BUCKET_LABELS[i]} mana
                        </p>
                        <div className="space-y-0.5">
                          {entries.slice(0, TOOLTIP_MAX_NAMES).map(([name, n]) => (
                            <div
                              key={name}
                              className="flex items-baseline gap-1.5 text-ui-label text-muted-foreground"
                            >
                              <span className="min-w-3 shrink-0 text-right text-ui-meta font-mono tabular-nums">
                                {n}
                              </span>
                              <span className="break-words">{name}</span>
                            </div>
                          ))}
                          {entries.length > TOOLTIP_MAX_NAMES && (
                            <p className="pt-0.5 text-ui-meta text-muted-foreground/60">
                              +{entries.length - TOOLTIP_MAX_NAMES} more
                            </p>
                          )}
                        </div>
                        {onBucketClick && (
                          <p className="mt-1.5 border-t border-border/40 pt-1.5 text-ui-meta text-muted-foreground/60">
                            {isActive ? `Click to clear the filter` : `Click to filter the deck`}
                          </p>
                        )}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>

            <div className="mt-1.5 flex gap-1.5">
              {CMC_BUCKET_LABELS.map((label, i) => (
                <div key={i} className="flex-1 text-center">
                  <span
                    className={cn(
                      "text-ui-meta transition-colors",
                      hoveredBucket === i || activeBucket === i
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-ui-body text-muted-foreground italic text-center py-6">
          {cards.length === 0 ? `No cards in deck.` : `Add non-land cards to see the curve.`}
        </p>
      )}
    </section>
  );
}
