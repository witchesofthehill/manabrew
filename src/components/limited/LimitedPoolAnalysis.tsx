import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LimitedCompareDialog } from "@/components/limited/LimitedCompareDialog";
import { LimitedAnalysisSummary } from "@/components/limited/LimitedAnalysisSummary";
import { LimitedManaAnalysis } from "@/components/limited/LimitedManaAnalysis";
import { LimitedRoleCorrections } from "@/components/limited/LimitedRoleCorrections";
import { analyzeLimitedCards } from "@/components/limited/limitedPoolAnalysis.utils";
import {
  EMPTY_ROLE_OVERRIDES,
  useLimitedAnalysisStore,
} from "@/components/limited/useLimitedAnalysisStore";
import { useLimitedAnalysisMetadata } from "@/components/limited/useLimitedAnalysisMetadata";
import type { DraftCard } from "@/types/limited";

interface Props {
  sessionKey: string;
  pool: DraftCard[];
  deck: { main: DraftCard[]; sideboard: DraftCard[] };
}

export function LimitedPoolAnalysis({ sessionKey, pool, deck }: Props) {
  const [compareOpen, setCompareOpen] = useState(false);
  const overrides = useLimitedAnalysisStore(
    (state) => state.overrides[sessionKey] ?? EMPTY_ROLE_OVERRIDES,
  );
  const allCards = useMemo(() => {
    const unique: Record<string, DraftCard> = {};
    for (const card of [...pool, ...deck.main, ...deck.sideboard]) unique[card.id] = card;
    return Object.values(unique);
  }, [pool, deck.main, deck.sideboard]);
  const metadata = useLimitedAnalysisMetadata(allCards);
  const analyzedPool = useMemo(
    () => analyzeLimitedCards(pool, metadata.cache, overrides),
    [pool, metadata.cache, overrides],
  );
  const analyzedMain = useMemo(
    () => analyzeLimitedCards(deck.main, metadata.cache, overrides),
    [deck.main, metadata.cache, overrides],
  );
  const analyzedAll = useMemo(
    () => analyzeLimitedCards(allCards, metadata.cache, overrides),
    [allCards, metadata.cache, overrides],
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg">Pool and mana analysis</h2>
        <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
          Compare builds
        </Button>
      </div>
      {metadata.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading real card metadata. Counts cover resolved cards only.
        </p>
      )}
      {metadata.errors.length > 0 && (
        <div role="alert" className="space-y-2 rounded border border-border p-3 text-xs">
          <p>
            Some card metadata could not load. Those cards are excluded, not counted as zero-cost
            cards.
          </p>
          <ul className="max-h-28 overflow-y-auto">
            {metadata.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <Button variant="outline" size="sm" onClick={metadata.retry}>
            Retry metadata
          </Button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <LimitedAnalysisSummary title="Entire acquired pool" cards={analyzedPool} />
        <LimitedAnalysisSummary title="Current mainboard" cards={analyzedMain} />
      </div>
      <details className="rounded border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Mainboard source probabilities
        </summary>
        <div className="mt-3">
          <LimitedManaAnalysis cards={analyzedMain} />
        </div>
      </details>
      <LimitedRoleCorrections sessionKey={sessionKey} cards={analyzedAll} />
      <LimitedCompareDialog
        sessionKey={sessionKey}
        current={deck.main}
        open={compareOpen}
        onOpenChange={setCompareOpen}
      />
    </div>
  );
}
