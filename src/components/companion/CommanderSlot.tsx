import { useEffect, useId, useState, type ReactNode } from "react";
import { Loader2, Search, X } from "lucide-react";
import { ScryfallImg } from "@/components/ScryfallImg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scryfallDisplayName, scryfallDisplayTypeLine } from "@/lib/scryfall.utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { CompanionCommanderRef } from "@/stores/useCompanionStore.types";
import type { ScryfallCard } from "@/types/scryfall";

interface CommanderSlotProps {
  slotLabel: string;
  action?: ReactNode;
  query: string;
  pick: CompanionCommanderRef | null;
  onQueryChange: (query: string) => void;
  onPick: (pick: CompanionCommanderRef | null) => void;
}

const SEARCH_DEBOUNCE_MS = 220;

export function CommanderSlot({
  slotLabel,
  action,
  query,
  pick,
  onQueryChange,
  onPick,
}: CommanderSlotProps) {
  const inputId = useId();
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || pick) return;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      useScryfallStore
        .getState()
        .searchCards(`${trimmed} -is:digital`, 1, "name", "asc")
        .then((response) => {
          setResults(response.data.slice(0, 12));
          setLoading(false);
        })
        .catch((err: unknown) => {
          setResults([]);
          setLoading(false);
          setError(err instanceof Error ? err.message : "No matches");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, pick]);

  const separator = pick?.name.indexOf(" // ") ?? -1;
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {pick ? (
          <span className="text-ui-label font-medium">{slotLabel}</span>
        ) : (
          <Label htmlFor={inputId}>{slotLabel}</Label>
        )}
        {action}
      </div>
      {pick ? (
        <div className="flex items-center gap-2.5 rounded-md border border-border bg-card py-1.5 pl-2 pr-1">
          {pick.imageUrl && (
            <ScryfallImg
              src={pick.imageUrl}
              alt=""
              className="h-10 w-8 shrink-0 rounded-sm object-cover"
              draggable={false}
            />
          )}
          <div className="min-w-0 flex-1 break-words leading-snug">
            <div className="text-ui-label font-semibold">
              {separator < 0 ? pick.name : pick.name.slice(0, separator)}
            </div>
            {separator >= 0 && (
              <div className="text-ui-meta text-muted-foreground">
                {pick.name.slice(separator + 4)}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              onPick(null);
              onQueryChange("");
            }}
            aria-label={`Clear ${slotLabel.toLowerCase()}`}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={inputId}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search Scryfall…"
              className="pl-8 pr-8"
            />
            {loading && (
              <Loader2 className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {error && <p className="text-ui-meta text-destructive">{error}</p>}
          {Boolean(query.trim()) && results.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1">
              {results.map((card) => {
                const imageUrl =
                  card.image_uris?.art_crop ??
                  card.card_faces?.[0]?.image_uris?.art_crop ??
                  card.image_uris?.small ??
                  card.card_faces?.[0]?.image_uris?.small;
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-ui-label hover:bg-accent touch:min-h-11 touch:min-w-11"
                      onClick={() => onPick({ scryfallId: card.id, name: card.name, imageUrl })}
                    >
                      {imageUrl && (
                        <ScryfallImg
                          src={imageUrl}
                          alt=""
                          className="size-8 shrink-0 rounded-sm object-cover"
                          draggable={false}
                        />
                      )}
                      <div className="flex min-w-0 flex-col break-words">
                        <span className="font-medium">{scryfallDisplayName(card)}</span>
                        <span className="text-ui-meta text-muted-foreground">
                          {scryfallDisplayTypeLine(card)} · {card.set.toUpperCase()}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
