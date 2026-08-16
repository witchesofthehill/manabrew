import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign } from "lucide-react";

import { Input } from "@/components/ui/input";
import { scryfallCardKey } from "@/api/scryfall";
import { useDeckStore } from "@/stores/useDeckStore";
import { EDITOR_PANEL_CLASS } from "./deckEditor.styles";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { ScryfallCard } from "@/types/scryfall";

type PriceProvider = "tcgplayer" | "cardmarket" | "cardhoarder";
type CardPrices = ScryfallCard["prices"];

const PRICE_PROVIDERS: Record<
  PriceProvider,
  {
    label: string;
    unit: string;
    suffix?: string;
    getPrice: (prices: CardPrices, foil: boolean) => string | undefined;
  }
> = {
  tcgplayer: {
    label: "TCGplayer",
    unit: "$",
    getPrice: (prices, foil) => (foil ? prices.usd_foil : prices.usd),
  },
  cardmarket: {
    label: "Cardmarket",
    unit: "€",
    getPrice: (prices, foil) => (foil ? prices.eur_foil : prices.eur),
  },
  cardhoarder: {
    label: "Cardhoarder",
    unit: "",
    suffix: " tix",
    getPrice: (prices) => prices.tix,
  },
};

export function DeckBudgetPanel() {
  const deck = useDeckStore((state) => state.currentDeck);
  const setEditorMetadata = useDeckStore((state) => state.setEditorMetadata);
  const [prices, setPrices] = useState<Record<string, CardPrices>>({});
  const provider: PriceProvider = deck.editor?.priceProvider ?? "tcgplayer";
  const providerConfig = PRICE_PROVIDERS[provider];
  const printings = useMemo(
    () =>
      [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])].map((card) => ({
        name: card.identity.name,
        setCode: card.identity.setCode,
        collectorNumber: card.identity.cardNumber,
        foil: card.identity.foil ?? false,
      })),
    [deck.cards, deck.commanders, deck.sideboard],
  );

  useEffect(() => {
    if (printings.length === 0) return;
    let active = true;
    void useScryfallStore
      .getState()
      .fetchCardCollection(printings)
      .then((cards) => {
        if (!active) return;
        const next: Record<string, CardPrices> = {};
        for (const printing of printings) {
          const key = scryfallCardKey(printing.name, printing.setCode, printing.collectorNumber);
          const card = cards.get(key);
          if (!card) continue;
          next[key] = card.prices;
        }
        setPrices(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [printings]);

  const { total, unavailable } = printings.reduce(
    (result, card) => {
      const cardPrices = prices[scryfallCardKey(card.name, card.setCode, card.collectorNumber)];
      const value = Number(cardPrices && providerConfig.getPrice(cardPrices, card.foil));
      return Number.isFinite(value)
        ? { ...result, total: result.total + value }
        : { ...result, unavailable: result.unavailable + 1 };
    },
    { total: 0, unavailable: 0 },
  );
  const budget = deck.editor?.budgetAmount ?? deck.editor?.budgetUsd;
  const overBudget = budget !== undefined && total > budget;
  const formatPrice = (value: number) =>
    `${providerConfig.unit}${value.toFixed(2)}${providerConfig.suffix ?? ""}`;

  function updateEditorMetadata(updates: { budgetAmount?: number; priceProvider?: PriceProvider }) {
    setEditorMetadata({
      ...deck.editor,
      version: 1,
      tags: deck.editor?.tags ?? [],
      layouts: deck.editor?.layouts ?? [],
      ...updates,
    });
  }

  return (
    <section className={EDITOR_PANEL_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Deck budget</h3>
            <p className="text-[10px] text-muted-foreground">
              Current selected printings · {PRICE_PROVIDERS[provider].label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Provider
            <select
              value={provider}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              onChange={(event) =>
                updateEditorMetadata({ priceProvider: event.target.value as PriceProvider })
              }
            >
              {Object.entries(PRICE_PROVIDERS).map(([id, option]) => (
                <option key={id} value={id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
                updateEditorMetadata({ budgetAmount: value });
              }}
            />
          </label>
          <div className="text-right">
            <p className={`font-mono text-xl font-semibold ${overBudget ? "text-warning" : ""}`}>
              {formatPrice(total)}
            </p>
            {budget !== undefined && (
              <p className="text-[10px] text-muted-foreground">
                {overBudget
                  ? `${formatPrice(total - budget)} over`
                  : `${formatPrice(budget - total)} left`}
              </p>
            )}
            {unavailable > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {unavailable} {unavailable === 1 ? "card" : "cards"} unavailable
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
