import { Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { ScryfallCard } from "@/types/scryfall";

interface DevCardSearchProps {
  value: string;
  onSelect: (card: ScryfallCard) => void;
}

export function DevCardSearch({ value, onSelect }: DevCardSearchProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const searchIdRef = useRef(0);

  const search = useCallback((nextQuery: string) => {
    const trimmed = nextQuery.trim();
    const searchId = ++searchIdRef.current;
    if (trimmed.length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    useScryfallStore
      .getState()
      .searchCards(`${trimmed} -is:digital -is:funny`, 1)
      .then((response) => {
        if (searchId !== searchIdRef.current) return;
        setResults(response.data.slice(0, 12));
        setActiveIndex(0);
        setOpen(true);
      })
      .catch(() => {
        if (searchId !== searchIdRef.current) return;
        setResults([]);
        setOpen(false);
      })
      .finally(() => {
        if (searchId === searchIdRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.clearTimeout(timerRef.current);
      searchIdRef.current += 1;
    };
  }, []);

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => search(nextQuery), 350);
  };

  const selectCard = (card: ScryfallCard) => {
    window.clearTimeout(timerRef.current);
    searchIdRef.current += 1;
    setQuery(card.name);
    setResults([]);
    setOpen(false);
    onSelect(card);
  };

  const clear = () => {
    window.clearTimeout(timerRef.current);
    searchIdRef.current += 1;
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls="dev-card-search-results"
          aria-activedescendant={
            open && results[activeIndex]
              ? `dev-card-search-result-${results[activeIndex].id}`
              : undefined
          }
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault();
              selectCard(results[activeIndex]);
            } else if (event.key === "Escape") {
              setQuery(value);
              setOpen(false);
            }
          }}
          placeholder="Search Scryfall"
          className="pl-9 pr-9"
          spellCheck={false}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : query ? (
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={clear}
            title="Clear card search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {open && results.length > 0 ? (
        <div
          id="dev-card-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
        >
          <div className="sticky top-0 z-10 border-b border-border bg-popover px-3 py-1.5 text-[10px] text-muted-foreground">
            Select a card to stage it on the battlefield
          </div>
          {results.map((card, index) => {
            const thumbnail = card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
            return (
              <button
                key={card.id}
                id={`dev-card-search-result-${card.id}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border/30 px-3 py-2 text-left transition-colors last:border-0 hover:bg-muted",
                  activeIndex === index && "bg-muted",
                )}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => selectCard(card)}
              >
                {thumbnail ? (
                  <ScryfallImg
                    src={thumbnail}
                    alt=""
                    className="h-14 w-10 shrink-0 rounded object-cover object-top"
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{card.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {card.type_line}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                  {card.set}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
