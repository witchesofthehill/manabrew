import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { searchCards } from "@/api/scryfall";
import type { ScryfallCard } from "@/types/scryfall";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionCommanderRef } from "@/stores/useCompanionStore.types";

interface CommanderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerId: string;
  initial: [CompanionCommanderRef | null, CompanionCommanderRef | null];
}

interface SlotState {
  query: string;
  pick: CompanionCommanderRef | null;
}

const SEARCH_DEBOUNCE_MS = 220;

export function CommanderPickerDialog({
  open,
  onOpenChange,
  playerId,
  initial,
}: CommanderPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose commander</DialogTitle>
        </DialogHeader>
        {open && (
          <CommanderPickerForm
            playerId={playerId}
            initial={initial}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CommanderPickerForm({
  playerId,
  initial,
  onClose,
}: {
  playerId: string;
  initial: [CompanionCommanderRef | null, CompanionCommanderRef | null];
  onClose: () => void;
}) {
  const setCommander = useCompanionStore((s) => s.setCommander);
  const oathbreaker = useCompanionStore((s) => s.session?.oathbreaker ?? false);
  const partnerLabel = oathbreaker ? "Signature spell" : "Partner / Background";
  const [partnerEnabled, setPartnerEnabled] = useState(Boolean(initial[1]));
  const [slots, setSlots] = useState<[SlotState, SlotState]>([
    { query: initial[0]?.name ?? "", pick: initial[0] },
    { query: initial[1]?.name ?? "", pick: initial[1] },
  ]);

  const updateSlot = useCallback((index: 0 | 1, patch: Partial<SlotState>) => {
    setSlots((prev) => {
      const next: [SlotState, SlotState] = [prev[0], prev[1]];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const confirm = () => {
    setCommander(playerId, 0, slots[0].pick);
    setCommander(playerId, 1, partnerEnabled ? slots[1].pick : null);
    onClose();
  };

  const clearAll = () => {
    setCommander(playerId, 0, null);
    setCommander(playerId, 1, null);
    onClose();
  };

  return (
    <>
      <div className="space-y-4">
        <CommanderSlot
          slotLabel="Commander"
          query={slots[0].query}
          pick={slots[0].pick}
          onQueryChange={(query) => updateSlot(0, { query })}
          onPick={(pick) => updateSlot(0, { pick })}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={partnerEnabled}
            onChange={(e) => setPartnerEnabled(e.target.checked)}
            className="size-4 accent-primary"
          />
          {partnerLabel} slot
        </label>
        {partnerEnabled && (
          <CommanderSlot
            slotLabel={partnerLabel}
            query={slots[1].query}
            pick={slots[1].pick}
            onQueryChange={(query) => updateSlot(1, { query })}
            onPick={(pick) => updateSlot(1, { pick })}
          />
        )}
      </div>
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={clearAll}>
          Clear
        </Button>
        <Button onClick={confirm} disabled={!slots[0].pick && !(partnerEnabled && slots[1].pick)}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

interface CommanderSlotProps {
  slotLabel: string;
  query: string;
  pick: CompanionCommanderRef | null;
  onQueryChange: (q: string) => void;
  onPick: (ref: CompanionCommanderRef | null) => void;
}

function CommanderSlot({ slotLabel, query, pick, onQueryChange, onPick }: CommanderSlotProps) {
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const trimmed = query.trim();
    if (!trimmed || pick) return;

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchCards(`${trimmed} -is:digital`, 1, "name", "asc")
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

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, pick]);

  if (pick) {
    return (
      <div className="space-y-1">
        <Label>{slotLabel}</Label>
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-2">
          {pick.imageUrl && (
            <img
              src={pick.imageUrl}
              alt=""
              className="h-12 w-9 rounded-sm object-cover"
              draggable={false}
            />
          )}
          <div className="flex-1 truncate text-sm font-medium">{pick.name}</div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              onPick(null);
              onQueryChange("");
            }}
            aria-label="Clear"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  const showResults = Boolean(query.trim()) && results.length > 0;

  return (
    <div className="space-y-1">
      <Label>{slotLabel}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search Scryfall…"
          className="pl-8"
        />
        {loading && (
          <Loader2 className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {showResults && (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border bg-popover p-1">
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
                  className={cn(
                    "flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                  )}
                  onClick={() =>
                    onPick({
                      scryfallId: card.id,
                      name: card.name,
                      imageUrl,
                    })
                  }
                >
                  {imageUrl && (
                    <img
                      src={imageUrl}
                      alt=""
                      className="size-8 rounded-sm object-cover"
                      draggable={false}
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="font-medium">{card.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {card.type_line} · {card.set.toUpperCase()}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
