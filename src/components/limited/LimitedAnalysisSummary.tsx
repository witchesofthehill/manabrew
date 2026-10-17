import { ManaSymbols } from "@/components/game/ManaSymbols";
import { MANA_LETTERS } from "@/themes/gameTheme";
import {
  summarizeLimitedCards,
  type AnalyzedLimitedCard,
} from "@/components/limited/limitedPoolAnalysis.utils";

export function LimitedAnalysisSummary({
  title,
  cards,
}: {
  title: string;
  cards: AnalyzedLimitedCard[];
}) {
  const summary = summarizeLimitedCards(cards);
  return (
    <section className="space-y-3 rounded-md border border-border bg-card/40 p-3 text-xs">
      <h3 className="font-semibold">
        {title} · {summary.total} cards
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt>Creatures</dt>
        <dd className="text-right font-mono">{summary.creatures}</dd>
        <dt>Interaction</dt>
        <dd className="text-right font-mono">{summary.interaction}</dd>
        <dt>Fixing</dt>
        <dd className="text-right font-mono">{summary.fixing}</dd>
        <dt>Lands</dt>
        <dd className="text-right font-mono">{summary.lands}</dd>
        <dt>Supported physical land sources</dt>
        <dd className="text-right font-mono">{summary.physicalSources}</dd>
      </dl>
      <div>
        <h4 className="mb-1 text-muted-foreground">Creatures by mana value</h4>
        <div className="grid grid-cols-7 gap-1 text-center">
          {summary.curve.map((count, index) => (
            <div key={index} className="rounded bg-muted/40 p-1">
              <div className="font-mono tabular-nums">{count}</div>
              <div className="text-muted-foreground">{index === 6 ? "6+" : index}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="mb-1 text-muted-foreground">Printed colored requirements, not sources</h4>
        <div className="flex flex-wrap gap-3">
          {MANA_LETTERS.filter(
            (color) => summary.requirements[color] || summary.alternatives[color],
          ).map((color) => (
            <div key={color} className="flex items-center gap-1">
              <ManaSymbols cost={`{${color}}`} size="sm" />
              <span className="font-mono">{summary.requirements[color]}</span>
              {summary.alternatives[color] > 0 && (
                <span className="text-muted-foreground">
                  + {summary.alternatives[color]} alternative
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="mb-1 text-muted-foreground">Supported land sources by color</h4>
        <div className="flex flex-wrap gap-3">
          {MANA_LETTERS.map((color) => (
            <div key={color} className="flex items-center gap-1">
              <ManaSymbols cost={`{${color}}`} size="sm" />
              <span className="font-mono">{summary.sources[color]}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-muted-foreground">
          Dual lands appear in both colors but count once physically. Conditional and unsupported
          abilities are excluded.
        </p>
      </div>
      {summary.missing > 0 && (
        <p role="status" className="text-muted-foreground">
          {summary.missing} cards lack metadata and are excluded from counts.
        </p>
      )}
    </section>
  );
}
