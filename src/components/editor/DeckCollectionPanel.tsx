import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  Download,
  LayoutGrid,
  LibraryBig,
  List,
  PackageCheck,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { scryfallCardKey } from "@/api/scryfall";
import { collectionQuantityForName, deckOwnershipByName } from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { EDITOR_PANEL_CLASS, EDITOR_SUBTLE_BLOCK_CLASS } from "./deckEditor.styles";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { CardThumbnail } from "./deckEditor.primitives";
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE } from "./deckBuilder.utils";
import { executeDeckEdit } from "./deckEditor.history";

export function DeckCollectionPanel({
  cardSize,
  onHover,
  onLeave,
  onOptimizeOwnedPrintings,
}: {
  cardSize: number;
  onHover?: (card: DeckCard, event: MouseEvent) => void;
  onLeave?: () => void;
  onOptimizeOwnedPrintings?: () => void;
}) {
  const [view, setView] = useState<"text" | "grid">("text");
  const deck = useDeckStore((state) => state.currentDeck);
  const quantities = useCollectionStore((state) => state.quantities);
  const accountId = useCollectionStore((state) => state.accountId);
  const loading = useCollectionStore((state) => state.loading);
  const setQuantity = useCollectionStore((state) => state.setQuantity);
  const setEditorMetadata = useDeckStore((state) => state.setEditorMetadata);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const allCards = useMemo(
    () => [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])],
    [deck.cards, deck.commanders, deck.sideboard],
  );
  const rows = useMemo(() => {
    const required = new Map<string, { name: string; quantity: number; card: DeckCard }>();
    for (const card of allCards) {
      const key = card.identity.name.toLowerCase();
      const entry = required.get(key) ?? { name: card.identity.name, quantity: 0, card };
      entry.quantity += 1;
      required.set(key, entry);
    }
    return [...required].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [allCards]);
  const ownership = useMemo(
    () => deckOwnershipByName(quantities, allCards),
    [allCards, quantities],
  );
  const missing = useMemo(
    () =>
      rows.filter(([key]) => {
        const status = ownership.get(key)?.status;
        return status === "missing" || status === "partial";
      }),
    [ownership, rows],
  );
  const otherPrintingCount = useMemo(
    () => [...ownership.values()].filter((entry) => entry.status === "other").length,
    [ownership],
  );
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? CARD_WIDTH_MAP[DEFAULT_CARD_SIZE];
  const provider = deck.editor?.priceProvider ?? "tcgplayer";
  const acquisition = deck.editor?.acquisition ?? {};

  const missingPrintings = useMemo(
    () =>
      missing.map(([, entry]) => ({
        name: entry.name,
        setCode: entry.card.identity.setCode,
        collectorNumber: entry.card.identity.cardNumber,
      })),
    [missing],
  );

  useEffect(() => {
    if (missingPrintings.length === 0) return;
    let active = true;
    void useScryfallStore
      .getState()
      .fetchCardCollection(missingPrintings)
      .then((cards) => {
        if (!active) return;
        const next: Record<string, number> = {};
        for (const printing of missingPrintings) {
          const key = scryfallCardKey(printing.name, printing.setCode, printing.collectorNumber);
          const card = cards.get(key);
          const value = Number(
            provider === "cardmarket"
              ? card?.prices.eur
              : provider === "cardhoarder"
                ? card?.prices.tix
                : card?.prices.usd,
          );
          if (Number.isFinite(value)) next[printing.name.toLowerCase()] = value;
        }
        setPrices(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [missingPrintings, provider]);

  const estimatedTotal = missing.reduce((total, [key]) => {
    const shortage = ownership.get(key)?.shortage ?? 0;
    return total + (prices[key] ?? 0) * shortage;
  }, 0);

  function setOwnedQuantity(key: string, name: string, quantity: number) {
    const currentTotal = collectionQuantityForName(quantities, name);
    const printingTotal = currentTotal - (quantities[key] ?? 0);
    void setQuantity(key, Math.max(0, quantity - printingTotal)).catch(() => {
      toast.error("Account sync failed. This change is preserved locally.");
    });
  }

  function exportMissing() {
    const csv = [
      "Quantity,Card Name,Set,Collector Number,Finish,Status,Estimated Unit Price",
      ...missing.map(([key, entry]) => {
        const shortage = ownership.get(key)?.shortage ?? 0;
        return `${shortage},"${entry.name.replaceAll('"', '""')}",${entry.card.identity.setCode},${entry.card.identity.cardNumber},${entry.card.identity.foil ? "foil" : "nonfoil"},${acquisition[key] ?? "needed"},${prices[key] ?? ""}`;
      }),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${deck.name || "deck"}-missing-cards.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function setAcquisitionStatus(key: string, status?: "ordered" | "proxy") {
    const next = { ...acquisition };
    if (status) next[key] = status;
    else delete next[key];
    executeDeckEdit(`Mark ${key} as ${status ?? "needed"}`, () =>
      setEditorMetadata({
        ...deck.editor,
        version: 1,
        tags: deck.editor?.tags ?? [],
        layouts: deck.editor?.layouts ?? [],
        acquisition: next,
      }),
    );
  }

  return (
    <section className={EDITOR_PANEL_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LibraryBig className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Collection coverage</h3>
            <p className="text-[10px] text-muted-foreground">
              {accountId ? "Synced to your account" : "Saved on this device"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn("text-xs", missing.length > 0 ? "text-warning" : "text-legality-legal")}
          >
            {loading
              ? "Syncing…"
              : missing.length === 0
                ? otherPrintingCount > 0
                  ? `Complete · ${otherPrintingCount} other ${otherPrintingCount === 1 ? "printing" : "printings"}`
                  : "Deck complete"
                : `${missing.length} cards missing`}
          </span>
          {missing.length > 0 && estimatedTotal > 0 && (
            <span className="text-xs font-mono text-muted-foreground">
              est. {provider === "cardmarket" ? "€" : provider === "cardhoarder" ? "" : "$"}
              {estimatedTotal.toFixed(2)}
              {provider === "cardhoarder" ? " tix" : ""}
            </span>
          )}
          {(missing.length > 0 || otherPrintingCount > 0) && onOptimizeOwnedPrintings && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onOptimizeOwnedPrintings}
            >
              <Sparkles className="h-3.5 w-3.5" /> Use owned printings
            </Button>
          )}
          {missing.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={exportMissing}>
              <Download className="h-3.5 w-3.5" /> Missing CSV
            </Button>
          )}
          <div className="flex overflow-hidden rounded-md border">
            <ViewButton label="Grid view" active={view === "grid"} onClick={() => setView("grid")}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </ViewButton>
            <ViewButton
              label="Text view"
              active={view === "text"}
              onClick={() => setView("text")}
              bordered
            >
              <List className="h-3.5 w-3.5" />
            </ViewButton>
          </div>
        </div>
      </div>
      {missing.length > 0 && (
        <div
          className={cn(
            "mt-4",
            view === "text" ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-wrap gap-4",
          )}
        >
          {missing.map(([key, entry]) => (
            <div
              key={key}
              className={cn(
                view === "text"
                  ? cn("flex items-center gap-2", EDITOR_SUBTLE_BLOCK_CLASS)
                  : "block min-w-0",
              )}
              style={view === "grid" ? { width: cardWidth } : undefined}
              onMouseEnter={(event) => onHover?.(entry.card, event)}
              onMouseLeave={onLeave}
            >
              {view === "grid" && <CardThumbnail card={entry.card} loading="lazy" />}
              <span className={cn("flex flex-wrap items-center gap-2", view === "grid" && "mt-2")}>
                <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {ownership.get(key)?.status === "partial" ? "partially owned" : "not owned"} ·
                  need {ownership.get(key)?.shortage ?? entry.quantity}
                </span>
                <Input
                  type="number"
                  min="0"
                  className="h-7 w-16 text-right font-mono text-xs"
                  aria-label={`Owned copies of ${entry.name}`}
                  value={collectionQuantityForName(quantities, entry.name)}
                  onChange={(event) =>
                    setOwnedQuantity(key, entry.name, Number(event.target.value))
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant={acquisition[key] === "ordered" ? "secondary" : "ghost"}
                  className="h-7 w-7"
                  title="Mark as ordered"
                  aria-pressed={acquisition[key] === "ordered"}
                  onClick={() =>
                    setAcquisitionStatus(
                      key,
                      acquisition[key] === "ordered" ? undefined : "ordered",
                    )
                  }
                >
                  <PackageCheck className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant={acquisition[key] === "proxy" ? "secondary" : "ghost"}
                  className="h-7 w-7"
                  title="Mark as proxied"
                  aria-pressed={acquisition[key] === "proxy"}
                  onClick={() =>
                    setAcquisitionStatus(key, acquisition[key] === "proxy" ? undefined : "proxy")
                  }
                >
                  <ScanLine className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ViewButton({
  label,
  active,
  bordered = false,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  bordered?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "p-1.5 transition-colors",
        bordered && "border-l",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
