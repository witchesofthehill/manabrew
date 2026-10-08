import { useState } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Input } from "@/components/ui/input";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { probabilityAtLeast } from "@/lib/deckProbability";
import { MANA_LETTERS } from "@/themes/gameTheme";
import type { AnalyzedLimitedCard } from "@/components/limited/limitedPoolAnalysis.utils";

export function LimitedManaAnalysis({ cards }: { cards: AnalyzedLimitedCard[] }) {
  const [onDraw, setOnDraw] = useState(false);
  const [turn, setTurn] = useState(3);
  const [pips, setPips] = useState(1);
  const [targetId, setTargetId] = useState("");
  const spells = cards.filter((card) => card.known && !card.land && card.cost);
  const target = spells.find((card) => card.card.id === targetId);
  const lands = cards.filter((card) => card.known && card.land);
  const seen = Math.min(cards.length, 6 + turn + Number(onDraw));
  const earlierSeen = Math.min(cards.length, 5 + turn + Number(onDraw));
  const excluded = cards.filter((card) => card.source.excluded.length > 0);
  return (
    <section className="space-y-3 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-muted-foreground">Starting position</span>
          <AppSelect
            aria-label="Starting position"
            value={onDraw ? "draw" : "play"}
            onValueChange={(value) => setOnDraw(value === "draw")}
          >
            <AppSelectOption value="play">On the play</AppSelectOption>
            <AppSelectOption value="draw">On the draw</AppSelectOption>
          </AppSelect>
        </label>
        <label className="space-y-1">
          <span className="block text-muted-foreground">Turn</span>
          <Input
            aria-label="Mana analysis turn"
            type="number"
            min={1}
            max={20}
            value={turn}
            className="w-20"
            onChange={(event) =>
              setTurn(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
            }
          />
        </label>
        <label className="space-y-1">
          <span className="block text-muted-foreground">Sources needed per color</span>
          <Input
            aria-label="Sources needed per color"
            type="number"
            min={1}
            max={20}
            value={pips}
            disabled={!!target}
            className="w-20"
            onChange={(event) =>
              setPips(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
            }
          />
        </label>
        <label className="min-w-0 flex-1 space-y-1">
          <span className="block text-muted-foreground">Use a spell's printed pips</span>
          <AppSelect
            aria-label="Spell mana requirements"
            value={targetId}
            onValueChange={setTargetId}
          >
            <AppSelectOption value="">Manual requirement</AppSelectOption>
            {spells.map((card) => (
              <AppSelectOption key={card.card.id} value={card.card.id}>
                <DynamicTextRender text={`${card.card.name} · ${card.cost}`} />
              </AppSelectOption>
            ))}
          </AppSelect>
        </label>
      </div>
      <p className="text-muted-foreground">
        {cards.length} mainboard cards, {lands.length} known lands. Two or more lands in seven
        cards:{" "}
        {Math.round(
          probabilityAtLeast(cards.length, lands.length, Math.min(7, cards.length), 2) * 100,
        )}
        %.
      </p>
      {cards.length < 7 && (
        <p className="text-muted-foreground">
          This mainboard has fewer than seven cards. Probabilities use the available cards, not a
          complete seven-card opener.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left">
          <caption className="mb-2 text-left text-muted-foreground">
            Source draw probabilities, not spell castability
          </caption>
          <thead className="text-muted-foreground">
            <tr>
              <th className="p-2">Color</th>
              <th className="p-2">Required</th>
              <th className="p-2">Untapped / tapped</th>
              <th className="p-2">Draw by turn {turn}</th>
              <th className="p-2">Timing floor</th>
            </tr>
          </thead>
          <tbody>
            {MANA_LETTERS.filter((color) => !target || target.requirements[color] > 0).map(
              (color) => {
                const sources = lands.filter((card) => card.source.colors.includes(color));
                const tapped = sources.filter((card) => card.source.tapped).length;
                const required = target?.requirements[color] ?? pips;
                const drawChance = probabilityAtLeast(cards.length, sources.length, seen, required);
                const timingChance =
                  required > turn || (tapped > 0 && required > turn - 1)
                    ? 0
                    : probabilityAtLeast(
                        cards.length,
                        sources.length,
                        tapped > 0 ? earlierSeen : seen,
                        required,
                      );
                return (
                  <tr key={color} className="border-t border-border">
                    <td className="p-2">
                      <ManaSymbols cost={`{${color}}`} size="sm" />
                    </td>
                    <td className="p-2 font-mono">{required}</td>
                    <td className="p-2 font-mono">
                      {sources.length - tapped} / {tapped}
                    </td>
                    <td className="p-2 font-mono">{Math.round(drawChance * 100)}%</td>
                    <td className="p-2 font-mono">{Math.round(timingChance * 100)}%</td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
      {target && !MANA_LETTERS.some((color) => target.requirements[color] > 0) && (
        <p className="text-muted-foreground">
          This spell has no mandatory single-color pips. Its alternative payments are not source
          requirements in both colors.
        </p>
      )}
      {target && (
        <p className="text-muted-foreground">
          <DynamicTextRender text={`${target.card.name} costs ${target.cost}.`} /> Generic mana and
          simultaneous colors are not tested.{" "}
          {target.alternativeCost
            ? "Alternative, variable, snow or cost-reduction payments are not modeled."
            : ""}
        </p>
      )}
      <details className="rounded border border-border p-3">
        <summary className="cursor-pointer font-semibold">
          Model assumptions and excluded sources
        </summary>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>
            Seven-card opener, no mulligans, one draw per turn, no turn-one draw on the play. One
            land played per turn. Only front-face lands with basic land types or unconditional
            single-mana tap abilities count. Life totals and damage from supported tap abilities are
            not tracked.
          </p>
          <p>
            Always-tapped lands cannot supply mana on the turn they enter. When a color has any
            tapped sources, the timing floor requires all needed sources drawn and played by the
            previous turn. This is conservative: it also excludes a new untapped source on the
            target turn. Turn one is zero with this mixed-source floor. With only untapped sources,
            the floor uses this turn's draw.
          </p>
          <p>
            Each dual land is one physical card, but appears in every color it can produce. Color
            rows are separate events. Do not add their counts or multiply their probabilities. These
            odds do not establish castability, which also needs the spell, total mana, simultaneous
            color payments and land sequencing with other colors.
          </p>
          <p>
            Fetch lands, conditional entry, restricted mana, mana filters, multiple-mana abilities,
            nonland mana, tokens and back-face land choices are excluded unless a separate supported
            ability exists. Unknown metadata is excluded. Hybrid and Phyrexian pips are
            alternatives, not mandatory payments in both colors.
          </p>
          {excluded.length > 0 ? (
            <ul className="space-y-1">
              {excluded.map((card) => (
                <li key={card.card.id}>
                  <span className="font-medium text-foreground">{card.card.name}</span>:{" "}
                  {card.source.excluded.join(" ")}
                </li>
              ))}
            </ul>
          ) : (
            <p>No excluded mana abilities found in the known mainboard cards.</p>
          )}
        </div>
      </details>
    </section>
  );
}
