import { Plus, X } from "lucide-react";
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
  const [status, setStatus] = useState<"loading" | "error" | "ready">("ready");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
  const insidePointerRef = useRef<Event | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchIdRef = useRef(0);
  const pulseRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const request = parseDeckQuickAdd(value);

  useKeybindings({
    "deck-editor-focus-quick-add": () => {
      if (!inputRef.current?.getClientRects().length) return false;
      setOptionsCard(null);
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });
  const doSearch = useCallback((query: string) => {
    const searchId = ++searchIdRef.current;
    useScryfallStore
      .getState()
      .searchCards(`${query} -is:digital -is:funny`, 1)
      .then(
        (response) => {
          if (searchId !== searchIdRef.current) return;
          setResults(response.data.slice(0, 20));
          setStatus("ready");
        },
        () => {
          if (searchId === searchIdRef.current) setStatus("error");
        },
      );
  }, []);
  const dismiss = useCallback(() => {
    clearTimeout(debounceRef.current);
    searchIdRef.current += 1;
    setStatus("ready");
    setIsOpen(false);
    setOptionsCard(null);
  }, []);
  function handleChange(nextValue: string) {
    clearTimeout(debounceRef.current);
    searchIdRef.current += 1;
    const query = parseDeckQuickAdd(nextValue).query;
    setValue(nextValue);
    setOptionsCard(null);
    setResults([]);
    setActiveIndex(0);
    setIsOpen(query.length >= 2);
    setStatus(query.length >= 2 ? "loading" : "ready");
    if (query.length >= 2) debounceRef.current = setTimeout(() => doSearch(query), 400);
  }
  function openOptions(card: ScryfallCard) {
    setOptionsCard(card);
    setQuantity(request.quantity);
    setDestination(request.destination);
    setTags(request.tags);
    setIsOpen(false);
  }
  function markAdded(card: ScryfallCard) {
    clearTimeout(pulseRef.current);
    setRecentlyAddedId(card.id);
    pulseRef.current = setTimeout(() => setRecentlyAddedId(null), 350);
  }
  function quickAdd(card: ScryfallCard, destination: DeckQuickAddRequest["destination"] = "main") {
    if (!onAdd(card, { query: card.name, quantity: 1, destination, tags: [] })) return;
    markAdded(card);
    inputRef.current?.focus();
  }
  function chooseCard(card: ScryfallCard) {
    if (request.quantity > 1 || request.destination !== "main" || request.tags.length > 0) {
      openOptions(card);
      return;
    }
    quickAdd(card);
  }
  function closeOptions() {
    setOptionsCard(null);
    setIsOpen(true);
    inputRef.current?.focus();
  }
  function addWithOptions() {
    if (!optionsCard) return;
    if (!onAdd(optionsCard, { query: optionsCard.name, quantity, destination, tags })) return;
    markAdded(optionsCard);
    closeOptions();
  }
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event !== insidePointerRef.current) dismiss();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dismiss]);
  useEffect(
    () => () => {
      searchIdRef.current += 1;
      clearTimeout(debounceRef.current);
      clearTimeout(pulseRef.current);
    },
    [],
  );
  return (
    <div
      className="relative min-w-0"
      onPointerDownCapture={(event) => {
        insidePointerRef.current = event.nativeEvent;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest('[role="menu"]')) return;
        event.preventDefault();
        inputRef.current?.focus();
        dismiss();
      }}
    >
      <div className="relative">
        <Plus className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="min-h-8 pl-8 pr-9 shadow-none touch:pr-11"
          placeholder="Add cards by name…"
          aria-label="Add cards by name"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => {
            if (request.query.length < 2) return;
            setIsOpen(true);
            if (results.length === 0) handleChange(value);
          }}
          onKeyDown={(event) => {
            if (
              !isOpen ||
              status !== "ready" ||
              results.length === 0 ||
              event.nativeEvent.isComposing
            )
              return;
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
        {value && (
          <button
            type="button"
            className="absolute right-0 top-1/2 inline-flex min-h-7 min-w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11 touch:min-w-11"
            onClick={() => {
              inputRef.current?.focus();
              handleChange("");
            }}
            title="Clear card search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {(optionsCard || isOpen) && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[min(24rem,60dvh)] w-96 max-w-[calc(100cqw-2rem)] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg @xl:left-auto @xl:right-0">
          {optionsCard ? (
            <DeckQuickAddOptions
              card={optionsCard}
              quantity={quantity}
              destination={destination}
              tags={tags}
              customTags={customTags}
              mainCount={getCount(optionsCard.name)}
              onQuantityChange={setQuantity}
              onDestinationChange={setDestination}
              onTagsChange={setTags}
              onAdd={addWithOptions}
              onClose={closeOptions}
            />
          ) : (
            <DeckQuickAddResults
              results={results}
              status={status}
              request={request}
              activeIndex={activeIndex}
              recentlyAddedId={recentlyAddedId}
              onActiveIndexChange={setActiveIndex}
              onQuickAdd={chooseCard}
              onOptions={openOptions}
              onRetry={() => {
                inputRef.current?.focus();
                handleChange(value);
              }}
              getCount={getCount}
            />
          )}
        </div>
      )}
    </div>
  );
}
