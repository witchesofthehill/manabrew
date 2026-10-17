import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LimitedDeckStats } from "@/components/limited/LimitedDeckStats";
import { useDeckStore } from "@/stores/useDeckStore";
import type { DraftCard } from "@/types/limited";
import { deckMainAsDraftCards } from "@/lib/limited.utils";
import { buildDeck, useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { LimitedAnalysisSummary } from "@/components/limited/LimitedAnalysisSummary";
import {
  analyzeLimitedCards,
  type AnalyzedLimitedCard,
} from "@/components/limited/limitedPoolAnalysis.utils";
import {
  EMPTY_ROLE_OVERRIDES,
  useLimitedAnalysisStore,
} from "@/components/limited/useLimitedAnalysisStore";
import { useLimitedAnalysisMetadata } from "@/components/limited/useLimitedAnalysisMetadata";
interface Props {
  current: DraftCard[];
  sessionKey?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
const LIMITED_FORMATS: Record<string, true> = { draft: true, sealed: true };
export function LimitedCompareDialog({ current, sessionKey, open, onOpenChange }: Props) {
  const savedDecks = useDeckStore((s) => s.savedDecks);
  const session = useLimitedBuildStore((state) =>
    sessionKey ? state.sessions[sessionKey] : undefined,
  );
  const overrides = useLimitedAnalysisStore((state) =>
    sessionKey ? (state.overrides[sessionKey] ?? EMPTY_ROLE_OVERRIDES) : EMPTY_ROLE_OVERRIDES,
  );
  const [selectedId, setSelectedId] = useState<string>("");
  const limitedDecks = useMemo(
    () => savedDecks.filter((d) => LIMITED_FORMATS[d.deck.format ?? "draft"]).reverse(),
    [savedDecks],
  );
  const choices = useMemo(
    () => [
      ...(session?.builds.map((build) => ({
        id: `build:${build.id}`,
        name: `Pool build · ${build.name}`,
        cards: buildDeck({ pool: session.pool, allocation: build }).main,
        local: true,
      })) ?? []),
      ...limitedDecks.map((saved) => ({
        id: `saved:${saved.id}`,
        name: `Saved deck · ${saved.deck.name}`,
        cards: deckMainAsDraftCards(saved.deck),
        local: false,
      })),
    ],
    [session, limitedDecks],
  );
  const selected = choices.find((choice) => choice.id === selectedId);
  const otherCards = selected?.cards ?? [];
  const metadata = useLimitedAnalysisMetadata(open ? [...current, ...otherCards] : []);
  const currentAnalysis = analyzeLimitedCards(current, metadata.cache, overrides);
  const otherAnalysis = analyzeLimitedCards(
    otherCards,
    metadata.cache,
    selected?.local ? overrides : EMPTY_ROLE_OVERRIDES,
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare Limited builds</DialogTitle>
          <DialogDescription>
            Compare named builds from this pool or saved Limited decks. Role, creature curve and
            fixing counts use real card metadata. Saved decks use suggested roles, not this pool's
            corrections.
          </DialogDescription>
        </DialogHeader>

        {choices.length === 0 ? (
          <p className="rounded border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
            No comparison builds yet. Keep a named build in Build configurations or use Save to My
            Decks to save a Limited deck.
          </p>
        ) : (
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Compare with</span>
              <AppSelect
                aria-label="Compare Limited build"
                value={selectedId}
                onValueChange={setSelectedId}
                className="flex-1 rounded border border-border/70 bg-background px-2 py-1 text-sm pointer-coarse:text-base"
              >
                <AppSelectOption value="">Choose a build</AppSelectOption>
                {choices.map((choice) => (
                  <AppSelectOption key={choice.id} value={choice.id}>
                    {choice.name} · {choice.cards.length} cards
                  </AppSelectOption>
                ))}
              </AppSelect>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <CompareColumn title="Current build" cards={current} analysis={currentAnalysis} />
              <CompareColumn
                title={selected?.name ?? "Choose a build"}
                cards={otherCards}
                analysis={otherAnalysis}
                empty={!selected}
              />
            </div>
          </div>
        )}
        {metadata.loading && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading metadata. Unresolved cards are excluded.
          </p>
        )}
        {metadata.errors.length > 0 && (
          <div role="alert" className="space-y-2 text-xs">
            <ul>
              {metadata.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={metadata.retry}>
              Retry metadata
            </Button>
          </div>
        )}

        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function CompareColumn({
  title,
  cards,
  analysis,
  empty,
}: {
  title: string;
  cards: DraftCard[];
  analysis: AnalyzedLimitedCard[];
  empty?: boolean;
}) {
  return (
    <section className="rounded border border-border/50 bg-card/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}{" "}
        <span className="text-muted-foreground/70">({empty ? "—" : `${cards.length} cards`})</span>
      </h3>
      {empty ? (
        <p className="text-xs text-muted-foreground">Pick a build to see its breakdown.</p>
      ) : (
        <div className="space-y-3">
          <LimitedDeckStats cards={cards} />
          <LimitedAnalysisSummary title="Roles and mana sources" cards={analysis} />
        </div>
      )}
    </section>
  );
}
