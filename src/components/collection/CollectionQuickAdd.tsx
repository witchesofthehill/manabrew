import { Loader2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import { searchCards } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ScryfallCard } from "@/types/scryfall";

interface CollectionQuickAddProps {
  getCount: (name: string) => number;
  onAdd: (
    name: string,
    quantity: number,
    setCode: string,
    collectorNumber: string,
    foil: boolean,
  ) => void;
  onHover: (card: ScryfallCard, event: MouseEvent) => void;
  onLeave: () => void;
}

export function CollectionQuickAdd({ getCount, onAdd, onHover, onLeave }: CollectionQuickAddProps) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [quantityCard, setQuantityCard] = useState<ScryfallCard | null>(null);
  const [quantity, setQuantity] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);

  const runSearch = useCallback((query: string) => {
    const searchId = ++searchIdRef.current;
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    searchCards(`${query} -is:digital -is:funny`, 1)
      .then((response) => {
        if (searchId !== searchIdRef.current) return;
        setResults(response.data.slice(0, 20));
        setActiveIndex(0);
        setOpen(true);
      })
      .catch(() => {
        if (searchId === searchIdRef.current) setResults([]);
      })
      .finally(() => {
        if (searchId === searchIdRef.current) setLoading(false);
      });
  }, []);

  function updateSearch(nextValue: string) {
    setValue(nextValue);
    setQuantityCard(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(nextValue), 400);
  }

  function add(card: ScryfallCard, count = 1) {
    onAdd(card.name, count, card.set, card.collector_number, !card.finishes?.includes("nonfoil"));
    setQuantityCard(null);
    setOpen(true);
  }

  useEffect(() => {
    function dismiss(event: globalThis.MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuantityCard(null);
      }
    }
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div ref={containerRef} className="relative min-w-56 flex-1 sm:max-w-xs">
      <div className="relative">
        <Plus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          className="pl-9 pr-8"
          placeholder="Quick add card…"
          onChange={(event) => updateSearch(event.target.value)}
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
              add(results[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : value ? (
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Clear card search"
            onClick={() => updateSearch("")}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {quantityCard ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover p-3 shadow-lg">
          <p className="truncate text-sm font-medium">{quantityCard.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {getCount(quantityCard.name)} currently owned
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setQuantity((count) => Math.max(1, count - 1))}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <Input
              type="number"
              min="1"
              value={quantity}
              className="h-8 w-16 text-center font-mono"
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setQuantity((count) => count + 1)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => add(quantityCard, quantity)}>
              Add {quantity}
            </Button>
          </div>
        </div>
      ) : open && results.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 min-w-72 overflow-y-auto rounded-md border bg-popover shadow-lg">
          <div className="sticky top-0 z-10 border-b bg-popover px-2 py-1 text-[10px] text-muted-foreground">
            Click or press Enter to add one to your collection
          </div>
          {results.map((card, index) => {
            const thumbnail = card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
            return (
              <div
                key={card.id}
                className={cn(
                  "flex items-center border-b border-border/30 last:border-0 hover:bg-muted",
                  activeIndex === index && "bg-muted",
                )}
                onMouseEnter={(event) => {
                  setActiveIndex(index);
                  onHover(card, event);
                }}
                onMouseLeave={onLeave}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
                  title={`Add one ${card.name}`}
                  onClick={() => add(card)}
                >
                  {thumbnail && (
                    <ScryfallImg
                      src={thumbnail}
                      alt=""
                      className="h-11 w-8 shrink-0 rounded object-cover object-top"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{card.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {getCount(card.name)} owned
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                </button>
                <button
                  type="button"
                  className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                  title={`Add multiple ${card.name}`}
                  onClick={() => {
                    setQuantity(1);
                    setQuantityCard(card);
                    setOpen(false);
                  }}
                >
                  <span className="text-xs font-semibold">×N</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
