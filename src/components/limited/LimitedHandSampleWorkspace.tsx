import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { CardPreviewOwnershipContext } from "@/hooks/useCardPreview";
import {
  advanceLimitedHandTurn,
  canAdvanceLimitedHandTurn,
  canMulliganLimitedHand,
  dealLimitedHand,
  keepLimitedHand,
  limitedHandBottomRequired,
  limitedHandLibraryCount,
  mulliganLimitedHand,
} from "@/lib/limitedHand.utils";
import type { LimitedHandPosition } from "@/lib/limitedHand.types";
import type { DraftCard } from "@/types/limited";

interface LimitedHandSampleWorkspaceProps {
  cards: DraftCard[];
  position: LimitedHandPosition;
  previewPortalTarget: HTMLElement | null;
}

export function LimitedHandSampleWorkspace({
  cards,
  position,
  previewPortalTarget,
}: LimitedHandSampleWorkspaceProps) {
  const [practice, setPractice] = useState(() => ({
    sample: dealLimitedHand(cards, position),
    selected: [] as number[],
  }));
  const [previewOwners] = useState(() => new Set<() => void>());
  const { sample, selected } = practice;
  const required = limitedHandBottomRequired(sample);
  const hand = useMemo(
    () => sample.hand.map((index) => sample.cards[index]),
    [sample.hand, sample.cards],
  );
  const bottom = useMemo(
    () => sample.bottom.map((index) => sample.cards[index]),
    [sample.bottom, sample.cards],
  );
  const libraryCount = limitedHandLibraryCount(sample);
  const nextTurn = sample.turn + 1;
  const skipsDraw = sample.turn === 0 && sample.position === "play";
  const toggleBottom = (card: DraftCard) => {
    setPractice((current) => {
      if (current.sample.kept) return current;
      const index = current.sample.hand.find((entry) => current.sample.cards[entry].id === card.id);
      if (index === undefined) return current;
      const wasSelected = current.selected.includes(index);
      if (!wasSelected && current.selected.length >= limitedHandBottomRequired(current.sample))
        return current;
      return {
        ...current,
        selected: wasSelected
          ? current.selected.filter((entry) => entry !== index)
          : [...current.selected, index],
      };
    });
  };

  if (cards.length === 0) {
    return (
      <p
        role="status"
        className="rounded border border-border bg-muted/30 p-4 text-sm text-muted-foreground"
      >
        This Mainboard is empty. Add cards in the builder or choose a named build to sample a hand.
      </p>
    );
  }

  return (
    <CardPreviewOwnershipContext.Provider value={previewOwners}>
      <section className="grid gap-3" aria-label="Practice opening hand">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums"
        >
          <span>
            Hand <strong>{sample.hand.length}</strong>
          </span>
          <span>
            Library <strong>{libraryCount}</strong>
          </span>
          <span>
            On bottom <strong>{sample.bottom.length}</strong>
          </span>
          <span>
            Mulligans <strong>{sample.mulligans}</strong>
          </span>
          <span>
            {sample.kept ? (sample.turn ? `Turn ${sample.turn}` : "Hand kept") : "Opening hand"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {sample.kept
            ? "Cards on bottom are part of the library. Hover or hold a card to inspect it; press I to pin its preview."
            : required > 0
              ? `Select ${required} ${required === 1 ? "card" : "cards"} to bottom before keeping. First selected goes above the others on bottom. Hover or hold to inspect; press I to pin.`
              : "Keep this hand or mulligan. Hover or hold a card to inspect it; press I to pin its preview."}
        </p>
        <LimitedCardCanvas
          cards={hand}
          selectedIds={sample.kept ? [] : selected.map((index) => sample.cards[index].id)}
          onSelect={!sample.kept && required > 0 ? toggleBottom : undefined}
          previewPortalTarget={previewPortalTarget}
          className="h-[min(42dvh,24rem)] min-h-40 rounded-lg border border-border bg-canvas-background"
          emptyMessage={
            sample.kept
              ? "You kept an empty hand. Begin drawing through your turns."
              : "No cards in hand."
          }
        />
        {!sample.kept && required > 0 && (
          <div className="grid gap-2">
            <p role="status" className="text-sm text-muted-foreground">
              {selected.length} of {required} selected to bottom
            </p>
            {selected.length > 0 && (
              <ol className="flex flex-wrap gap-2" aria-label="Selected bottom order">
                {selected.map((index, order) => (
                  <li key={sample.cards[index].id}>
                    <Button
                      variant="selected"
                      size="sm"
                      onClick={() => toggleBottom(sample.cards[index])}
                    >
                      {order + 1}. {sample.cards[index].name} · Remove
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!sample.kept ? (
            <>
              <Button
                variant="primary"
                disabled={selected.length !== required}
                onClick={() =>
                  setPractice((current) => ({
                    sample: keepLimitedHand(current.sample, current.selected),
                    selected: [],
                  }))
                }
              >
                Keep {sample.hand.length - required}
              </Button>
              <Button
                variant="outline"
                disabled={!canMulliganLimitedHand(sample)}
                onClick={() =>
                  setPractice((current) => ({
                    sample: mulliganLimitedHand(current.sample),
                    selected: [],
                  }))
                }
              >
                Mulligan
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              disabled={!canAdvanceLimitedHandTurn(sample)}
              onClick={() =>
                setPractice((current) => ({
                  ...current,
                  sample: advanceLimitedHandTurn(current.sample),
                }))
              }
            >
              {skipsDraw ? "Begin turn 1 · Skip draw" : `Turn ${nextTurn} · Draw a card`}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setPractice({ sample: dealLimitedHand(cards, position), selected: [] })}
          >
            Reshuffle and redeal
          </Button>
        </div>
        {sample.kept && (sample.turn > 0 || libraryCount === 0) && (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {sample.lastDrawn !== null
              ? `Turn ${sample.turn}: drew ${sample.cards[sample.lastDrawn].name}. `
              : sample.turn === 1 && sample.position === "play"
                ? "Turn 1: skipped your first draw on the play. "
                : ""}
            {libraryCount === 0
              ? "Library empty. Another draw would fail; redeal to start again."
              : ""}
          </p>
        )}
        {bottom.length > 0 && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
              Review {bottom.length} on bottom · first shown is drawn first
            </summary>
            <LimitedCardCanvas
              cards={bottom}
              previewPortalTarget={previewPortalTarget}
              className="h-56 border-t border-border bg-canvas-background"
            />
          </details>
        )}
      </section>
    </CardPreviewOwnershipContext.Provider>
  );
}
