import { Gauge } from "lucide-react";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { isLand } from "@/lib/mana";
import { probabilityAtLeast, probabilityAtLeastOne } from "@/lib/deckProbability";
import type { EditorDeck } from "@/types/manabrew";
import { EDITOR_PANEL_CLASS, EDITOR_SUBTLE_BLOCK_CLASS } from "./deckEditor.styles";
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
    <section className={EDITOR_PANEL_CLASS}>
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <h3 className="text-ui-label font-semibold">Mana consistency</h3>
        <span className="text-ui-meta text-muted-foreground">on the play</span>
      </div>
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
        <div className={EDITOR_SUBTLE_BLOCK_CLASS}>
          <p className="text-ui-body text-muted-foreground">Two or more lands in your opener</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
            {percentage(openingTwoLands)}
          </p>
          <p className="text-ui-meta text-muted-foreground">
            {lands.length} lands in {population} cards
          </p>
        </div>
        <div className="space-y-2">
          {colorRows.map(({ color, sourceCount, earliestTurn, chance }) => (
            <div
              key={color}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
            >
              <ManaSymbols cost={`{${color}}`} size="sm" />
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${MANA_BG_CLASS[color]}`}
                    style={{ width: percentage(chance) }}
                  />
                </div>
                <p className="mt-1 text-ui-meta text-muted-foreground">
                  {sourceCount} sources · needed by turn {earliestTurn}
                </p>
              </div>
              <span className="min-w-10 text-right font-mono text-ui-meta tabular-nums">
                {percentage(chance)}
              </span>
            </div>
          ))}
          {colorRows.length === 0 && (
            <p className="py-3 text-ui-body text-muted-foreground">
              Add coloured spells to see source odds.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
