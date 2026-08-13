import { useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ScryfallImg } from "@/components/ScryfallImg";
import { Button } from "@/components/ui/button";
import { searchCards } from "@/api/scryfall";
import { isLand } from "@/lib/mana";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import { useCardRolesStore } from "@/stores/useCardRolesStore";
import { useDeckStore } from "@/stores/useDeckStore";
import type { ScryfallCard } from "@/types/scryfall";
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE } from "./deckBuilder.utils";
import { executeDeckEdit } from "./deckEditor.history";
import { collectionQuantityForName } from "@/lib/collection";
import { useCollectionStore } from "@/stores/useCollectionStore";

export function ReplacementSuggestionsPanel({
  cardSize,
  onHover,
  onLeave,
}: {
  cardSize: number;
  onHover?: (card: DeckCard, event: MouseEvent) => void;
  onLeave?: () => void;
}) {
  const deck = useDeckStore((state) => state.currentDeck);
  const addToMain = useDeckStore((state) => state.addToMain);
  const removeFromMain = useDeckStore((state) => state.removeFromMain);
  const tagCard = useDeckStore((state) => state.tagCard);
  const quantities = useCollectionStore((state) => state.quantities);
  const [ownedOnly, setOwnedOnly] = useState(false);
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
  const [targetQuery, setTargetQuery] = useState("");
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [targetActiveIndex, setTargetActiveIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const filteredCandidates = candidates
    .filter((card) => card.identity.name.toLowerCase().includes(targetQuery.trim().toLowerCase()))
    .slice(0, 8);
  const target =
    candidates.find((card) => card.identity.name === targetName) ??
    filteredCandidates[0] ??
    candidates[0];
  const currentTargetRef = useRef(target?.identity.name);
  currentTargetRef.current = target?.identity.name;
  const suggestionCards = useMemo(
    () => suggestions.map((suggestion) => ({ suggestion, card: scryfallToDeckCard(suggestion) })),
    [suggestions],
  );
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? CARD_WIDTH_MAP[DEFAULT_CARD_SIZE];

  async function findSuggestions() {
    if (!target) return;
    const requestId = ++requestIdRef.current;
    const requestedTarget = target.identity.name;
    setTargetName(target.identity.name);
    setTargetQuery(target.identity.name);
    setTargetMenuOpen(false);
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
      const nextSuggestions = response.data
        .filter(
          (candidate) => !ownedOnly || collectionQuantityForName(quantities, candidate.name) > 0,
        )
        .slice(0, 4);
      if (requestId !== requestIdRef.current || currentTargetRef.current !== requestedTarget)
        return;
      setSuggestions(nextSuggestions);
      void useCardRolesStore.getState().ensureAnalyzed(nextSuggestions.map(scryfallToDeckCard));
    } catch (error) {
      if (requestId === requestIdRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not find replacements");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
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
          <label className="flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={ownedOnly}
              onChange={(event) => {
                setOwnedOnly(event.target.checked);
                setSuggestions([]);
              }}
            />
            Owned only
          </label>
          <div className="relative">
            <input
              type="text"
              role="combobox"
              aria-label="Card to replace"
              aria-autocomplete="list"
              aria-expanded={targetMenuOpen}
              aria-controls="replacement-target-suggestions"
              className="h-8 w-56 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              value={targetQuery || target.identity.name}
              onFocus={(event) => {
                event.currentTarget.select();
                setTargetMenuOpen(true);
              }}
              onBlur={() => setTargetMenuOpen(false)}
              onChange={(event) => {
                requestIdRef.current += 1;
                setLoading(false);
                setTargetQuery(event.target.value);
                setTargetName("");
                setSuggestions([]);
                setTargetActiveIndex(0);
                setTargetMenuOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setTargetMenuOpen(false);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setTargetActiveIndex((index) =>
                    Math.max(0, Math.min(index + 1, filteredCandidates.length - 1)),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setTargetActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter" && filteredCandidates[targetActiveIndex]) {
                  event.preventDefault();
                  requestIdRef.current += 1;
                  setLoading(false);
                  setTargetName(filteredCandidates[targetActiveIndex].identity.name);
                  setTargetQuery(filteredCandidates[targetActiveIndex].identity.name);
                  setSuggestions([]);
                  setTargetMenuOpen(false);
                }
              }}
            />
            {targetMenuOpen && (
              <div
                id="replacement-target-suggestions"
                role="listbox"
                className="absolute left-0 top-full z-30 mt-1 max-h-80 min-w-[300px] overflow-y-auto rounded-md border bg-popover shadow-lg"
              >
                <div className="sticky top-0 z-10 border-b bg-popover px-2 py-1 text-[10px] text-muted-foreground">
                  Choose a card from your deck to replace
                </div>
                {filteredCandidates.map((card, index) => (
                  <button
                    key={card.identity.name}
                    type="button"
                    role="option"
                    aria-selected={card.identity.name === target.identity.name}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-border/30 px-2 py-1 text-left last:border-0 hover:bg-muted",
                      targetActiveIndex === index && "bg-muted",
                    )}
                    onMouseEnter={(event) => {
                      setTargetActiveIndex(index);
                      onHover?.(card, event);
                    }}
                    onMouseLeave={onLeave}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      requestIdRef.current += 1;
                      setLoading(false);
                      setTargetName(card.identity.name);
                      setTargetQuery(card.identity.name);
                      setSuggestions([]);
                      setTargetMenuOpen(false);
                    }}
                  >
                    <ScryfallImg
                      src={card.uris.small || card.uris.normal}
                      alt=""
                      className="h-11 w-8 shrink-0 rounded object-cover object-top"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {card.identity.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      MV {card.cmc}
                    </span>
                  </button>
                ))}
                {filteredCandidates.length === 0 && (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    No cards in this deck match your search.
                  </p>
                )}
              </div>
            )}
          </div>
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
        <div className="mt-4 flex flex-wrap gap-3">
          {suggestionCards.map(({ suggestion, card }) => (
            <div
              key={suggestion.id}
              className="group relative shrink-0 cursor-pointer"
              style={{ width: cardWidth }}
              onMouseEnter={(event) => onHover?.(card, event)}
              onMouseLeave={onLeave}
            >
              <ScryfallImg
                src={
                  suggestion.image_uris?.normal ?? suggestion.card_faces?.[0]?.image_uris?.normal
                }
                alt={suggestion.name}
                className="w-full rounded-lg border border-border/50 shadow-sm"
                draggable={false}
              />
              <div className="mt-1 text-[10px] text-muted-foreground">
                Same {target.types[0]?.toLowerCase() ?? "card type"} · MV {suggestion.cmc}
                {collectionQuantityForName(quantities, suggestion.name) > 0
                  ? ` · ${collectionQuantityForName(quantities, suggestion.name)} owned`
                  : " · not owned"}
              </div>
              <button
                type="button"
                className="absolute right-1 top-1 z-20 rounded-full bg-overlay/80 p-1 text-foreground opacity-0 shadow transition-opacity hover:bg-primary hover:text-primary-foreground group-hover:opacity-100 pointer-coarse:opacity-100"
                title={`Replace one ${target.identity.name} with ${suggestion.name}`}
                aria-label={`Replace one ${target.identity.name} with ${suggestion.name}`}
                onClick={() => {
                  const tags = deck.cardTags?.[target.identity.name.toLowerCase()] ?? [];
                  executeDeckEdit(`Replace ${target.identity.name} with ${suggestion.name}`, () => {
                    removeFromMain(target.identity.id);
                    addToMain(card);
                    for (const tag of tags) tagCard(card.identity.name, tag);
                  });
                  toast.success(`Replaced ${target.identity.name} with ${suggestion.name}`);
                }}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
