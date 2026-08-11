import { Gauge } from "lucide-react";

import { ManaSymbols } from "@/components/game/ManaSymbols";
import { isLand } from "@/lib/mana";
import { probabilityAtLeast, probabilityAtLeastOne } from "@/lib/deckProbability";
import type { EditorDeck } from "@/types/manabrew";
import { MANA_BG_CLASS } from "@/themes/gameTheme";

const COLORS = ["W", "U", "B", "R", "G"] as const;

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ManaProbabilityPanel({ deck }: { deck: EditorDeck }) {
  const population = deck.cards.length;
  if (population === 0) return null;

  const lands = deck.cards.filter((card) => isLand(card.types));
  const openingTwoLands = probabilityAtLeast(population, lands.length, 7, 2);
  const colorRows = COLORS.flatMap((color) => {
    const spells = deck.cards.filter(
      (card) => !isLand(card.types) && card.manaCost?.includes(`{${color}}`),
    );
    if (spells.length === 0) return [];
    const earliestTurn = Math.max(
      1,
      Math.min(4, ...spells.map((card) => Math.ceil(card.cmc || 1))),
    );
    const sourceCount = lands.filter(
      (card) => card.text.includes(`{${color}}`) || card.colorIdentity?.includes(color),
    ).length;
    const cardsSeen = Math.min(population, 6 + earliestTurn);
    return [
      {
        color,
        sourceCount,
        earliestTurn,
        chance: probabilityAtLeastOne(population, sourceCount, cardsSeen),
      },
    ];
  });

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Mana consistency</h3>
        <span className="text-xs text-muted-foreground">on the play</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(10rem,0.7fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-border/60 bg-background/30 p-3">
          <p className="text-xs text-muted-foreground">Two or more lands in your opener</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
            {percentage(openingTwoLands)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {lands.length} lands in {population} cards
          </p>
        </div>
        <div className="space-y-2">
          {colorRows.map(({ color, sourceCount, earliestTurn, chance }) => (
            <div key={color} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <ManaSymbols cost={`{${color}}`} size="sm" />
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${MANA_BG_CLASS[color]}`}
                    style={{ width: percentage(chance) }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {sourceCount} sources · needed by turn {earliestTurn}
                </p>
              </div>
              <span className="w-10 text-right font-mono text-xs tabular-nums">
                {percentage(chance)}
              </span>
            </div>
          ))}
          {colorRows.length === 0 && (
            <p className="py-3 text-xs text-muted-foreground">
              Add coloured spells to see source odds.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
