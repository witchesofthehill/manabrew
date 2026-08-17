import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { useScryfallStore } from "@/stores/useScryfallStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDeckStore } from "@/stores/useDeckStore";
import type { ScryfallSet } from "@/types/scryfall";
import { executeDeckEdit } from "./deckEditor.history";

export function BatchPrintingDialog({
  open,
  onOpenChange,
  cardNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardNames?: ReadonlySet<string>;
}) {
  const [sets, setSets] = useState<ScryfallSet[]>([]);
  const [query, setQuery] = useState("");
  const [loadingSets, setLoadingSets] = useState(false);
  const [applyingSet, setApplyingSet] = useState<string | null>(null);
  const operationRef = useRef(0);

  useEffect(() => {
    if (!open || sets.length > 0) return;
    setLoadingSets(true);
    useScryfallStore
      .getState()
      .fetchSets()
      .then(setSets)
      .catch(() => toast.error("Could not load Magic sets"))
      .finally(() => setLoadingSets(false));
  }, [open, sets.length]);

  const filteredSets = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sets
      .filter(
        (set) =>
          !term || set.code.toLowerCase().includes(term) || set.name.toLowerCase().includes(term),
      )
      .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""))
      .slice(0, 100);
  }, [query, sets]);

  async function applySet(set: ScryfallSet) {
    const operation = ++operationRef.current;
    const startingState = useDeckStore.getState();
    const startingDeckId = startingState.currentDeckId;
    const startingDeck = startingState.currentDeck;
    setApplyingSet(set.code);
    try {
      const prints = await useScryfallStore.getState().fetchCardsBySet(set.code);
      const currentState = useDeckStore.getState();
      if (
        operation !== operationRef.current ||
        currentState.currentDeckId !== startingDeckId ||
        (startingDeckId === null && currentState.currentDeck !== startingDeck)
      ) {
        return;
      }
      const printsByName = new Map<string, (typeof prints)[number]>();
      for (const print of prints) {
        printsByName.set(print.name.toLowerCase(), print);
        for (const face of print.card_faces ?? []) {
          if (!printsByName.has(face.name.toLowerCase())) {
            printsByName.set(face.name.toLowerCase(), print);
          }
        }
      }

      const deck = useDeckStore.getState().currentDeck;
      const names = new Set(
        [
          ...deck.cards,
          ...deck.sideboard,
          ...(deck.maybeboard ?? []),
          ...(deck.commanders ?? []),
          ...(deck.attractions ?? []),
          ...(deck.contraptions ?? []),
          ...(deck.schemes ?? []),
          ...(deck.planes ?? []),
        ]
          .map((card) => card.identity.name)
          .filter((name) => !cardNames || cardNames.has(name.toLowerCase())),
      );
      const matches = [...names]
        .map((name) => ({ name, print: printsByName.get(name.toLowerCase()) }))
        .filter(
          (match): match is { name: string; print: (typeof prints)[number] } => !!match.print,
        );

      executeDeckEdit(`Use ${set.name} printings`, () => {
        for (const match of matches) {
          useDeckStore.getState().updatePrint(match.name, match.print);
        }
      });
      toast.success(
        matches.length > 0
          ? `Changed ${matches.length} card ${matches.length === 1 ? "printing" : "printings"} to ${set.name}`
          : `No cards in this deck have a ${set.name} printing`,
      );
      onOpenChange(false);
    } catch {
      if (operation === operationRef.current) {
        toast.error(`Could not load printings from ${set.name}`);
      }
    } finally {
      if (operation === operationRef.current) setApplyingSet(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) operationRef.current += 1;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change {cardNames ? "selected" : "deck"} printings</DialogTitle>
          <DialogDescription>
            Choose a set to update every matching card. Cards without a printing in that set stay
            unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="pl-9"
            placeholder="Search by set name or code…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <ScrollArea className="h-80">
          {loadingSets ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1 pr-3">
              {filteredSets.map((set) => (
                <Button
                  key={set.id}
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
                  disabled={applyingSet !== null}
                  onClick={() => void applySet(set)}
                >
                  <span className="w-12 shrink-0 font-mono text-xs uppercase text-muted-foreground">
                    {set.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{set.name}</span>
                  {applyingSet === set.code && <Loader2 className="h-4 w-4 animate-spin" />}
                </Button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
