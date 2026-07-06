import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LimitedDeckStats } from "@/components/limited/LimitedDeckStats";
import { useDeckStore, type SavedDeck } from "@/stores/useDeckStore";
import type { DraftCard } from "@/types/limited";
import { deckMainAsDraftCards } from "@/lib/limited.utils";

interface Props {
  current: DraftCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LIMITED_FORMATS = new Set(["draft", "sealed"]);

export function LimitedCompareDialog({ current, open, onOpenChange }: Props) {
  const savedDecks = useDeckStore((s) => s.savedDecks);
  const [selectedId, setSelectedId] = useState<string>("");

  const limitedDecks = useMemo(
    () => savedDecks.filter((d) => LIMITED_FORMATS.has(d.deck.format ?? "draft")).reverse(),
    [savedDecks],
  );

  const selected: SavedDeck | undefined = limitedDecks.find((d) => d.id === selectedId);
  const otherCards: DraftCard[] = useMemo(
    () => (selected ? deckMainAsDraftCards(selected.deck) : []),
    [selected],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare with saved deck</DialogTitle>
          <DialogDescription>
            Pick a previously saved limited deck to compare its mana curve, colour pips, and
            composition against the deck you're building right now.
          </DialogDescription>
        </DialogHeader>

        {limitedDecks.length === 0 ? (
          <p className="rounded border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
            No saved limited decks yet. Use "Save to My Decks" in the deck builder toolbar to save
            one.
          </p>
        ) : (
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Saved deck</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="flex-1 rounded border border-border/70 bg-background px-2 py-1 text-sm pointer-coarse:text-base"
              >
                <option value="">Choose…</option>
                {limitedDecks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.deck.name} ({d.deck.format ?? "draft"} · {d.deck.cards.length}/
                    {d.deck.sideboard.length})
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <CompareColumn title="Current build" cards={current} />
              <CompareColumn
                title={selected ? selected.deck.name : "—"}
                cards={otherCards}
                empty={!selected}
              />
            </div>
          </div>
        )}

        <div className="mt-2 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
  empty,
}: {
  title: string;
  cards: DraftCard[];
  empty?: boolean;
}) {
  return (
    <section className="rounded border border-border/50 bg-card/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}{" "}
        <span className="text-muted-foreground/70">({empty ? "—" : `${cards.length} cards`})</span>
      </h3>
      {empty ? (
        <p className="text-xs text-muted-foreground">Pick a saved deck to see its breakdown.</p>
      ) : (
        <LimitedDeckStats cards={cards} />
      )}
    </section>
  );
}
