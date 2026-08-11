import { Loader2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { Input } from "@/components/ui/input";
import { useKeybindings } from "@/hooks/useKeybindings";
import { cn } from "@/lib/utils";
import { searchCards } from "@/api/scryfall";
import type { ScryfallCard } from "@/types/scryfall";

import { parseDeckQuickAdd, type DeckQuickAddRequest } from "./deckQuickAdd.parser";

interface DeckQuickAddProps {
  onAdd: (card: ScryfallCard, request: DeckQuickAddRequest) => void;
  onRemove: (cardName: string) => void;
  getCount: (cardName: string) => number;
}

export function DeckQuickAdd({ onAdd, onRemove, getCount }: DeckQuickAddProps) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const request = parseDeckQuickAdd(value);

  useKeybindings({
    "deck-editor-focus-quick-add": () => {
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
    searchCards(`${query} -is:digital -is:funny`, 1)
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

  function add(card: ScryfallCard, override?: Partial<DeckQuickAddRequest>, keepOpen = false) {
    onAdd(card, { ...request, ...override });
    if (!keepOpen) {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      searchIdRef.current += 1;
      setValue("");
      setResults([]);
      setIsOpen(false);
    }
    inputRef.current?.focus();
  }

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
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
          placeholder="Quick add: 4 Bolt >side #removal"
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
              const destination = event.shiftKey
                ? "side"
                : event.altKey
                  ? "maybe"
                  : request.destination;
              add(results[activeIndex], { destination });
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
              onClick={() => {
                if (debounceRef.current !== null) clearTimeout(debounceRef.current);
                searchIdRef.current += 1;
                setValue("");
                setResults([]);
                setIsOpen(false);
              }}
              title="Clear quick add"
            >
              <X className="h-3 w-3" />
            </button>
          )
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 min-w-[300px] overflow-y-auto rounded-md border bg-popover shadow-lg">
          <div className="sticky top-0 z-10 flex gap-1 border-b bg-popover px-2 py-1 text-[10px] text-muted-foreground">
            <span>{request.quantity}×</span>
            <span>→ {request.destination}</span>
            {request.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
          {results.map((card, index) => {
            const count = getCount(card.name);
            const thumbnail = card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
            return (
              <div
                key={card.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-b border-border/30 px-2 py-1 last:border-0 hover:bg-muted",
                  activeIndex === index && "bg-muted",
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => add(card)}
                title={`Add ${request.quantity} ${card.name}`}
              >
                {thumbnail && (
                  <ScryfallImg
                    src={thumbnail}
                    alt=""
                    className="h-11 w-8 shrink-0 rounded object-cover object-top"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{card.name}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-destructive disabled:opacity-30"
                    title="Remove one"
                    disabled={count === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(card.name);
                    }}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-4 text-center font-mono text-xs tabular-nums">{count}</span>
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-primary"
                    title="Add one"
                    onClick={(event) => {
                      event.stopPropagation();
                      add(card, { quantity: 1, tags: [] }, true);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
