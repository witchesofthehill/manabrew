import { Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { ScryfallCard } from "@/types/scryfall";

import { DeckQuickAddOptions } from "./DeckQuickAddOptions";
import { DeckQuickAddResults } from "./DeckQuickAddResults";
import { parseDeckQuickAdd, type DeckQuickAddRequest } from "./deckQuickAdd.parser";

interface DeckQuickAddProps {
  customTags: string[];
  onAdd: (card: ScryfallCard, request: DeckQuickAddRequest) => boolean;
  getCount: (cardName: string) => number;
}

export function DeckQuickAdd({ customTags, onAdd, getCount }: DeckQuickAddProps) {
  const [value, setValue] = useState("");
  const [optionsCard, setOptionsCard] = useState<ScryfallCard | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [destination, setDestination] = useState<DeckQuickAddRequest["destination"]>("main");
  const [tags, setTags] = useState<string[]>([]);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);
  const pulseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useKeybindings({
    "deck-editor-focus-quick-add": () => {
      setOptionsCard(null);
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });

  const doSearch = useCallback((query: string) => {
    const searchId = ++searchIdRef.current;
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setIsLoading(true);
    useScryfallStore
      .getState()
      .searchCards(`${query} -is:digital -is:funny`, 1)
      .then((response) => {
        if (searchId !== searchIdRef.current) return;
        setResults(response.data.slice(0, 20));
        setActiveIndex(0);
        setIsOpen(true);
      })
      .catch(() => {
        if (searchId === searchIdRef.current) setResults([]);
      })
      .finally(() => {
        if (searchId === searchIdRef.current) setIsLoading(false);
      });
  }, []);

  function handleChange(nextValue: string) {
    setValue(nextValue);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(parseDeckQuickAdd(nextValue).query), 400);
  }

  function openOptions(card: ScryfallCard, request = parseDeckQuickAdd(value)) {
    setOptionsCard(card);
    setQuantity(request.quantity);
    setDestination(request.destination);
    setTags(request.tags);
    setIsOpen(false);
  }

  function markAdded(card: ScryfallCard) {
    if (pulseRef.current !== null) clearTimeout(pulseRef.current);
    setRecentlyAddedId(card.id);
    pulseRef.current = setTimeout(() => setRecentlyAddedId(null), 350);
  }

  function quickAdd(card: ScryfallCard, destination: DeckQuickAddRequest["destination"] = "main") {
    if (!onAdd(card, { query: card.name, quantity: 1, destination, tags: [] })) return;
    markAdded(card);
    inputRef.current?.focus();
  }

  function chooseCard(card: ScryfallCard) {
    const request = parseDeckQuickAdd(value);
    if (request.quantity > 1 || request.destination !== "main" || request.tags.length > 0) {
      openOptions(card, request);
      return;
    }
    quickAdd(card);
  }

  function clearSearch() {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    searchIdRef.current += 1;
    setValue("");
    setResults([]);
    setIsOpen(false);
  }

  function addWithOptions() {
    if (!optionsCard) return;
    if (!onAdd(optionsCard, { query: optionsCard.name, quantity, destination, tags })) return;
    markAdded(optionsCard);
    setOptionsCard(null);
    setIsOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setOptionsCard(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      if (pulseRef.current !== null) clearTimeout(pulseRef.current);
    },
    [],
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Plus className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="h-7 pl-6 pr-6 text-xs pointer-coarse:h-9 pointer-coarse:text-base"
          placeholder="Search card…"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault();
              if (event.shiftKey) quickAdd(results[activeIndex], "side");
              else if (event.altKey) quickAdd(results[activeIndex], "maybe");
              else chooseCard(results[activeIndex]);
            }
          }}
        />
        {isLoading ? (
          <Loader2 className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          value && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={clearSearch}
              title="Clear card search"
            >
              <X className="h-3 w-3" />
            </button>
          )
        )}
      </div>
      {optionsCard ? (
        <DeckQuickAddOptions
          card={optionsCard}
          quantity={quantity}
          destination={destination}
          tags={tags}
          customTags={customTags}
          onQuantityChange={setQuantity}
          onDestinationChange={setDestination}
          onTagsChange={setTags}
          onAdd={addWithOptions}
          onClose={() => {
            setOptionsCard(null);
            setIsOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      ) : isOpen && results.length > 0 ? (
        <DeckQuickAddResults
          results={results}
          activeIndex={activeIndex}
          recentlyAddedId={recentlyAddedId}
          onActiveIndexChange={setActiveIndex}
          onQuickAdd={chooseCard}
          onOptions={openOptions}
          getCount={getCount}
        />
      ) : null}
    </div>
  );
}
