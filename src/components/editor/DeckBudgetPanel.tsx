import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { scryfallCardKey } from "@/api/scryfall";
import { useDeckStore } from "@/stores/useDeckStore";
import { EDITOR_PANEL_CLASS } from "./deckEditor.styles";
import { executeDeckEdit } from "./deckEditor.history";
import { useDeckEditTransaction } from "./useDeckEditTransaction";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { ScryfallCard } from "@/types/scryfall";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
    get label() {
      return i18n._(msg`TCGplayer`);
    },
    unit: "$",
    getPrice: (prices, foil) => (foil ? prices.usd_foil : prices.usd),
  },
  cardmarket: {
    get label() {
      return i18n._(msg`Cardmarket`);
    },
    unit: "€",
    getPrice: (prices, foil) => (foil ? prices.eur_foil : prices.eur),
  },
  cardhoarder: {
    get label() {
      return i18n._(msg`Cardhoarder`);
    },
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
  const budgetEdit = useDeckEditTransaction("Update deck budget");
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
            <h3 className="text-sm font-semibold">
              <Trans>Deck budget</Trans>
            </h3>
            <p className="text-[10px] text-muted-foreground">
              <Trans>Current selected printings · {PRICE_PROVIDERS[provider].label}</Trans>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Trans>
              Provider
              <select
                value={provider}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                onChange={(event) =>
                  executeDeckEdit("Change price provider", () =>
                    updateEditorMetadata({ priceProvider: event.target.value as PriceProvider }),
                  )
                }
              >
                {Object.entries(PRICE_PROVIDERS).map(([id, option]) => (
                  <option key={id} value={id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Trans>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Trans>
              Limit
              <Input
                type="number"
                min="0"
                step="5"
                className="h-8 w-24 text-right font-mono"
                value={budget ?? ""}
                placeholder={i18n._(msg`None`)}
                onFocus={budgetEdit.begin}
                onChange={(event) => {
                  const value = event.target.value ? Number(event.target.value) : undefined;
                  updateEditorMetadata({ budgetAmount: value });
                }}
                onBlur={budgetEdit.commit}
              />
            </Trans>
          </label>
          <div className="text-right">
            <p className={`font-mono text-xl font-semibold ${overBudget ? "text-warning" : ""}`}>
              {formatPrice(total)}
            </p>
            {budget !== undefined && (
              <p className="text-[10px] text-muted-foreground">
                {overBudget
                  ? i18n._(msg`${formatPrice(total - budget)} over`)
                  : i18n._(msg`${formatPrice(budget - total)} left`)}
              </p>
            )}
            {unavailable > 0 && (
              <p className="text-[10px] text-muted-foreground">
                <Trans>
                  {unavailable} {unavailable === 1 ? "card" : "cards"} unavailable
                </Trans>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
