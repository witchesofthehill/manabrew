import { useMemo } from "react";
import { getScryfallManaCost } from "@/api/scryfall";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { countManaPips } from "@/lib/limited.utils";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
interface Props {
  cards: DraftCard[];
  className?: string;
  compact?: boolean;
}
const COLOR_KEYS = ["W", "U", "B", "R", "G"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
export function LimitedDeckStats({ cards, className, compact = false }: Props) {
  const cacheBucket = useScryfallStore((s) => s.cards);
  const stats = useMemo(() => {
    const colors: Record<ColorKey, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const curve = [0, 0, 0, 0, 0, 0, 0];
    let creatures = 0;
    let lands = 0;
    let spells = 0;
    let nonland = 0;
    let curveSampleSize = 0;
    for (const card of cards) {
      const cached = peekCard(cacheBucket, {
        name: card.name,
        setCode: card.setCode,
        cardNumber: card.cardNumber,
      });
      if (!cached) continue;
      const types = cached.card_faces?.[0]?.type_line ?? cached.type_line ?? "";
      const isLand = /\bLand\b/i.test(types);
      const isCreature = /\bCreature\b/i.test(types);
      if (isLand) lands += 1;
      else if (isCreature) creatures += 1;
      else spells += 1;
      if (!isLand) {
        nonland += 1;
        const cmc = Math.max(0, Math.min(6, Math.round(cached.cmc ?? 0)));
        curve[cmc] += 1;
        curveSampleSize += 1;
        const cost = getScryfallManaCost(cached) ?? "";
        for (const key of COLOR_KEYS) {
          colors[key] += countManaPips(cost, key);
        }
      }
    }
    const curveMax = Math.max(1, ...curve);
    return {
      colors,
      curve,
      curveMax,
      curveSampleSize,
      creatures,
      lands,
      spells,
      nonland,
      total: cards.length,
    };
  }, [cards, cacheBucket]);
  const colorTotal = COLOR_KEYS.reduce((acc, k) => acc + stats.colors[k], 0);
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 rounded-md border border-border/70 bg-card/40 p-3 text-ui-meta",
        compact && "grid-cols-1 gap-2 p-2",
        className,
      )}
    >
      <section>
        <h3 className="mb-1 text-ui-label font-semibold uppercase tracking-wide text-muted-foreground">
          Composition ({stats.total})
        </h3>
        <ul className="space-y-0.5">
          <StatRow label={`Creatures`} value={stats.creatures} total={stats.total} />
          <StatRow label={`Spells`} value={stats.spells} total={stats.total} />
          <StatRow label={`Lands`} value={stats.lands} total={stats.total} />
        </ul>
      </section>

      <section>
        <h3 className="mb-1 text-ui-label font-semibold uppercase tracking-wide text-muted-foreground">
          Mana curve {stats.curveSampleSize ? `(${stats.curveSampleSize} non-land)` : ""}
        </h3>
        <div className="flex h-24 items-end gap-1">
          {stats.curve.map((count, i) => {
            const heightPct = (count / stats.curveMax) * 100;
            return (
              <div key={`cmc-${i}`} className="flex h-full flex-1 flex-col items-center gap-1">
                <span className="text-ui-meta text-muted-foreground/80">{count || ""}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-sm bg-primary/60"
                    style={{ height: `${heightPct}%`, minHeight: count > 0 ? 2 : 0 }}
                  />
                </div>
                <span className="text-ui-meta text-muted-foreground">{i === 6 ? "6+" : i}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-ui-label font-semibold uppercase tracking-wide text-muted-foreground">
          Colour pips {colorTotal ? `(${colorTotal})` : ""}
        </h3>
        <ul className="space-y-0.5">
          {COLOR_KEYS.map((k) => (
            <li key={k} className="flex items-center gap-2">
              <ManaSymbols cost={`{${k}}`} size="sm" />
              <span className="tabular-nums lining-nums">{stats.colors[k]}</span>
              <div className="h-1.5 flex-1 rounded bg-muted/40">
                <div
                  className="h-full rounded bg-primary/60"
                  style={{
                    width: `${colorTotal ? (stats.colors[k] / colorTotal) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
function StatRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums lining-nums">
        {value} <span className="text-muted-foreground/70">· {pct}%</span>
      </span>
    </li>
  );
}
