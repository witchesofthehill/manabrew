import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign } from "lucide-react";

import { Input } from "@/components/ui/input";
import { fetchCardCollection, scryfallCardKey } from "@/api/scryfall";
import { useDeckStore } from "@/stores/useDeckStore";

export function DeckBudgetPanel() {
  const deck = useDeckStore((state) => state.currentDeck);
  const setEditorMetadata = useDeckStore((state) => state.setEditorMetadata);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const printings = useMemo(
    () =>
      [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])].map((card) => ({
        name: card.identity.name,
        setCode: card.identity.setCode,
        collectorNumber: card.identity.cardNumber,
      })),
    [deck.cards, deck.commanders, deck.sideboard],
  );

  useEffect(() => {
    if (printings.length === 0) return;
    let active = true;
    void fetchCardCollection(printings)
      .then((cards) => {
        if (!active) return;
        const next: Record<string, number> = {};
        for (const [key, card] of cards) {
          const value = Number(card.prices.usd_foil ?? card.prices.usd);
          if (Number.isFinite(value)) next[key] = value;
        }
        setPrices(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [printings]);

  const total = printings.reduce(
    (sum, card) =>
      sum + (prices[scryfallCardKey(card.name, card.setCode, card.collectorNumber)] ?? 0),
    0,
  );
  const budget = deck.editor?.budgetUsd;
  const overBudget = budget !== undefined && total > budget;

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Deck budget</h3>
            <p className="text-[10px] text-muted-foreground">Current selected printings · USD</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Limit
            <Input
              type="number"
              min="0"
              step="5"
              className="h-8 w-24 text-right font-mono"
              value={budget ?? ""}
              placeholder="None"
              onChange={(event) => {
                const value = event.target.value ? Number(event.target.value) : undefined;
                setEditorMetadata({
                  ...deck.editor,
                  version: 1,
                  tags: deck.editor?.tags ?? [],
                  layouts: deck.editor?.layouts ?? [],
                  budgetUsd: value,
                });
              }}
            />
          </label>
          <div className="text-right">
            <p className={`font-mono text-xl font-semibold ${overBudget ? "text-warning" : ""}`}>
              ${total.toFixed(2)}
            </p>
            {budget !== undefined && (
              <p className="text-[10px] text-muted-foreground">
                {overBudget
                  ? `$${(total - budget).toFixed(2)} over`
                  : `$${(budget - total).toFixed(2)} left`}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
