import { LibraryBig } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { useDeckStore } from "@/stores/useDeckStore";

export function DeckCollectionPanel() {
  const deck = useDeckStore((state) => state.currentDeck);
  const quantities = useCollectionStore((state) => state.quantities);
  const accountId = useCollectionStore((state) => state.accountId);
  const loading = useCollectionStore((state) => state.loading);
  const setQuantity = useCollectionStore((state) => state.setQuantity);
  const required = new Map<string, { name: string; quantity: number }>();
  for (const card of [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])]) {
    const key = card.identity.name.toLowerCase();
    const entry = required.get(key) ?? { name: card.identity.name, quantity: 0 };
    entry.quantity += 1;
    required.set(key, entry);
  }
  const rows = [...required].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const missing = rows.filter(([key, entry]) => (quantities[key] ?? 0) < entry.quantity);

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
        <span
          className={cn("text-xs", missing.length > 0 ? "text-warning" : "text-legality-legal")}
        >
          {loading
            ? "Syncing…"
            : missing.length === 0
              ? "Deck complete"
              : `${missing.length} cards missing`}
        </span>
      </div>
      {missing.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {missing.map(([key, entry]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-lg border bg-background/30 p-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>
              <span className="text-[10px] text-muted-foreground">need {entry.quantity}</span>
              <Input
                type="number"
                min="0"
                className="h-7 w-16 text-right font-mono text-xs"
                aria-label={`Owned copies of ${entry.name}`}
                value={quantities[key] ?? 0}
                onChange={(event) => void setQuantity(key, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
