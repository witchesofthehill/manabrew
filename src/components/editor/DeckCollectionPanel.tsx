import { useState, type MouseEvent, type ReactNode } from "react";
import { Download, LayoutGrid, LibraryBig, List } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { collectionQuantityForName } from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { CardThumbnail } from "./deckEditor.primitives";
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE } from "./deckBuilder.utils";

export function DeckCollectionPanel({
  cardSize,
  onHover,
  onLeave,
}: {
  cardSize: number;
  onHover?: (card: DeckCard, event: MouseEvent) => void;
  onLeave?: () => void;
}) {
  const [view, setView] = useState<"text" | "grid">("text");
  const deck = useDeckStore((state) => state.currentDeck);
  const quantities = useCollectionStore((state) => state.quantities);
  const accountId = useCollectionStore((state) => state.accountId);
  const loading = useCollectionStore((state) => state.loading);
  const setQuantity = useCollectionStore((state) => state.setQuantity);
  const required = new Map<string, { name: string; quantity: number; card: DeckCard }>();
  for (const card of [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])]) {
    const key = card.identity.name.toLowerCase();
    const entry = required.get(key) ?? { name: card.identity.name, quantity: 0, card };
    entry.quantity += 1;
    required.set(key, entry);
  }
  const rows = [...required].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const missing = rows.filter(
    ([, entry]) => collectionQuantityForName(quantities, entry.name) < entry.quantity,
  );
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? CARD_WIDTH_MAP[DEFAULT_CARD_SIZE];

  function setOwnedQuantity(key: string, name: string, quantity: number) {
    const currentTotal = collectionQuantityForName(quantities, name);
    const printingTotal = currentTotal - (quantities[key] ?? 0);
    void setQuantity(key, Math.max(0, quantity - printingTotal)).catch(() => {
      toast.error("Account sync failed. This change is preserved locally.");
    });
  }

  function exportMissing() {
    const csv = [
      "Quantity,Card Name",
      ...missing.map(([, entry]) => {
        const shortage = entry.quantity - collectionQuantityForName(quantities, entry.name);
        return `${shortage},"${entry.name.replaceAll('"', '""')}"`;
      }),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${deck.name || "deck"}-missing-cards.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border bg-card/40 p-5">
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
                ? "Deck complete"
                : `${missing.length} cards missing`}
          </span>
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
            <label
              key={key}
              className={cn(
                view === "text"
                  ? "flex items-center gap-2 rounded-lg border bg-background/30 p-2.5"
                  : "block min-w-0",
              )}
              style={view === "grid" ? { width: cardWidth } : undefined}
              onMouseEnter={(event) => onHover?.(entry.card, event)}
              onMouseLeave={onLeave}
            >
              {view === "grid" && <CardThumbnail card={entry.card} loading="lazy" />}
              <span className={cn("flex items-center gap-2", view === "grid" && "mt-2")}>
                <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>
                <span className="text-[10px] text-muted-foreground">need {entry.quantity}</span>
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
              </span>
            </label>
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
