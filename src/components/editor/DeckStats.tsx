import { useState } from "react";
import { useDeckStore } from "@/stores/useDeckStore";
import { cn } from "@/lib/utils";
import { isLand, countColorPips, countGenericMana } from "@/lib/mana";
import type { ManaColor } from "@/lib/mana";
import type { DeckCard } from "@/protocol/deck";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { MANA_LETTERS, MANA_BG_CLASS } from "@/themes/gameTheme";
import { CMC_BUCKET_LABELS, cmcBucketIndex } from "./deckBuilder.utils";

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
  activeBucket?: number | null;
  onBucketClick?: (bucket: number | null) => void;
}

export function DeckStats({ activeBucket = null, onBucketClick }: DeckStatsProps) {
  const { currentDeck } = useDeckStore();
  const cards = currentDeck.cards;
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);

  const lands: DeckCard[] = [];
  const unknown: DeckCard[] = [];
  const spells: { card: DeckCard; bucket: number }[] = [];

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

  const pipTotals: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let genericTotal = 0;
  for (const { card } of spells) {
    if (!card.manaCost) continue;
    const pips = countColorPips(card.manaCost);
    for (const c of MANA_LETTERS) pipTotals[c as ManaColor] += pips[c as ManaColor];
    genericTotal += countGenericMana(card.manaCost);
  }
  const totalPips = Object.values(pipTotals).reduce((a, b) => a + b, 0);
  const totalAll = totalPips + genericTotal;
  const activeColors = MANA_LETTERS.filter((c) => pipTotals[c as ManaColor] > 0);

  return (
    <section className="rounded-xl border bg-card/40 p-6">
      <div className="mb-5 flex items-baseline gap-2.5">
        <h3 className="text-base font-semibold">Mana Curve</h3>
        <span className="text-xs text-muted-foreground/70">
          {spells.length} spells &middot; {lands.length} lands
        </span>
        {unknown.length > 0 && (
          <span className="text-xs text-warning" title="CMC unknown">
            {unknown.length} ?
          </span>
        )}
      </div>

      {hasAnything ? (
        <>
          {/* Count labels */}
          <div className="flex gap-1.5 mb-1">
            {counts.map((count, i) => (
              <div key={i} className="flex-1 text-center">
                <span
                  className={cn(
                    "text-sm font-mono tabular-nums leading-none transition-colors",
                    count === 0 && "text-transparent select-none",
                    count > 0 && (hoveredBucket === i ? "text-foreground" : "text-foreground/80"),
                  )}
                >
                  {count}
                </span>
              </div>
            ))}
          </div>

          {/* Bar chart — hover for the card list, click to filter the deck */}
          <div className="flex items-end gap-1.5" style={{ height: BAR_MAX_PX }}>
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
                <div
                  key={i}
                  className={cn(
                    "relative flex h-full flex-1 items-end",
                    onBucketClick && count > 0 && "cursor-pointer",
                  )}
                  onMouseEnter={() => setHoveredBucket(count > 0 ? i : null)}
                  onMouseLeave={() => setHoveredBucket(null)}
                  onClick={() => {
                    if (count > 0) onBucketClick?.(isActive ? null : i);
                  }}
                >
                  <div
                    className={cn(
                      "w-full rounded-t-md transition-all duration-200",
                      BUCKET_BARS[i],
                      count === 0 && "opacity-15",
                      isDimmed && "opacity-40",
                      hoveredBucket === i && "brightness-110",
                      isActive && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                    )}
                    style={{
                      height: count > 0 ? `${Math.max((count / max) * BAR_MAX_PX, 4)}px` : "4px",
                    }}
                  />
                  {hoveredBucket === i && (
                    <div className="absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-60 -translate-x-1/2 rounded-md border bg-popover p-3 shadow-xl">
                      <p className="mb-1.5 text-xs font-semibold">
                        {count} card{count === 1 ? "" : "s"} at {CMC_BUCKET_LABELS[i]} mana
                      </p>
                      <ul className="space-y-0.5">
                        {entries.slice(0, TOOLTIP_MAX_NAMES).map(([name, n]) => (
                          <li
                            key={name}
                            className="flex items-baseline gap-1.5 text-xs text-muted-foreground"
                          >
                            <span className="w-3 shrink-0 text-right font-mono tabular-nums">
                              {n}
                            </span>
                            <span className="truncate">{name}</span>
                          </li>
                        ))}
                        {entries.length > TOOLTIP_MAX_NAMES && (
                          <li className="pt-0.5 text-[10px] text-muted-foreground/60">
                            +{entries.length - TOOLTIP_MAX_NAMES} more
                          </li>
                        )}
                      </ul>
                      {onBucketClick && (
                        <p className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground/60">
                          {isActive ? "Click to clear the filter" : "Click to filter the deck"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* CMC labels */}
          <div className="mt-1.5 flex gap-1.5">
            {CMC_BUCKET_LABELS.map((label, i) => (
              <div key={i} className="flex-1 text-center">
                <span
                  className={cn(
                    "text-xs transition-colors",
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

          {/* Colour distribution */}
          {(activeColors.length > 0 || genericTotal > 0) && (
            <div className="mt-7">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Colour Distribution
              </span>
              <div className="mt-2.5 space-y-2">
                {genericTotal > 0 && (
                  <div
                    className="flex items-center gap-2.5"
                    title={`${genericTotal} generic mana across ${spells.length} spells`}
                  >
                    <span className="inline-block w-3.5 h-3.5 rounded-sm shrink-0 border border-border bg-muted-foreground/40" />
                    <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300 bg-muted-foreground/60"
                        style={{
                          width: `${totalAll > 0 ? (genericTotal / totalAll) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground w-8 text-right shrink-0">
                      {Math.round(totalAll > 0 ? (genericTotal / totalAll) * 100 : 0)}%
                    </span>
                  </div>
                )}
                {activeColors.map((color) => {
                  const pips = pipTotals[color as ManaColor];
                  const pct = totalAll > 0 ? (pips / totalAll) * 100 : 0;
                  return (
                    <div
                      key={color}
                      className="flex items-center gap-2.5"
                      title={`${pips} ${color} pip${pips === 1 ? "" : "s"}`}
                    >
                      <ManaSymbols cost={`{${color}}`} size="sm" />
                      <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            MANA_BG_CLASS[color],
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono tabular-nums text-muted-foreground w-8 text-right shrink-0">
                        {Math.round(pct)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground italic text-center py-6">
          {cards.length === 0 ? "No cards in deck." : "Add non-land cards to see the curve."}
        </p>
      )}
    </section>
  );
}
