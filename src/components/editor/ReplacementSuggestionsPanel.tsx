import { useMemo, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { searchCards } from "@/api/scryfall";
import { isLand } from "@/lib/mana";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useDeckStore } from "@/stores/useDeckStore";
import type { ScryfallCard } from "@/types/scryfall";
import { executeDeckEdit } from "./deckEditor.history";

export function ReplacementSuggestionsPanel() {
  const deck = useDeckStore((state) => state.currentDeck);
  const addToMain = useDeckStore((state) => state.addToMain);
  const removeFromMain = useDeckStore((state) => state.removeFromMain);
  const candidates = useMemo(
    () =>
      [
        ...new Map(
          deck.cards
            .filter((card) => !isLand(card.types))
            .map((card) => [card.identity.name, card]),
        ).values(),
      ].sort((a, b) => b.cmc - a.cmc || a.identity.name.localeCompare(b.identity.name)),
    [deck.cards],
  );
  const [targetName, setTargetName] = useState("");
  const [suggestions, setSuggestions] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const target = candidates.find((card) => card.identity.name === targetName) ?? candidates[0];

  async function findSuggestions() {
    if (!target) return;
    setTargetName(target.identity.name);
    setLoading(true);
    try {
      const colors = target.colorIdentity.join("").toLowerCase();
      const identityQuery = colors ? `id<=${colors}` : "id=c";
      const type = target.types[0] ? `t:${target.types[0].toLowerCase()}` : "";
      const response = await searchCards(
        `${identityQuery} cmc=${Math.round(target.cmc)} ${type} -name:"${target.identity.name}"`,
        1,
        "edhrec",
      );
      setSuggestions(response.data.slice(0, 4));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not find replacements");
    } finally {
      setLoading(false);
    }
  }

  if (!target) return null;

  return (
    <section className="rounded-xl border bg-card/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Explainable replacements</h3>
            <p className="text-[10px] text-muted-foreground">
              Same colour identity, mana value, and primary card type.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <select
            className="h-8 max-w-56 rounded-md border bg-background px-2 text-xs"
            value={target.identity.name}
            onChange={(event) => {
              setTargetName(event.target.value);
              setSuggestions([]);
            }}
          >
            {candidates.map((card) => (
              <option key={card.identity.name}>{card.identity.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={loading}
            onClick={() => void findSuggestions()}
          >
            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Find swaps
          </Button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="flex items-center gap-3 rounded-lg border bg-background/30 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{suggestion.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {suggestion.type_line} · mana value {suggestion.cmc}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  executeDeckEdit(`Replace ${target.identity.name} with ${suggestion.name}`, () => {
                    removeFromMain(target.identity.id);
                    addToMain(scryfallToDeckCard(suggestion));
                  });
                  toast.success(`Replaced ${target.identity.name} with ${suggestion.name}`);
                }}
              >
                Replace one
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
