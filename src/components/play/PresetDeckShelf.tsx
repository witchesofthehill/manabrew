import { ChevronDown } from "lucide-react";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { DeckShelfRow } from "@/components/play/DeckShelfRow";
import { cn } from "@/lib/utils";
import type { PresetDeck } from "@/lib/presetDecks";

const SHELF_CARD_CLASS = "w-[70vw] max-w-64 shrink-0 snap-start sm:w-72 sm:max-w-none";

interface PresetDeckShelfProps {
  decks: PresetDeck[];
  loaded: boolean;
  open: boolean;
  pendingDeckId: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenDeck: (deck: PresetDeck) => void;
  onPlayDeck: (deck: PresetDeck) => void;
}

export function PresetDeckShelf({
  decks,
  loaded,
  open,
  pendingDeckId,
  onOpenChange,
  onOpenDeck,
  onPlayDeck,
}: PresetDeckShelfProps) {
  return (
    <div className="border-t border-border/70 pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <span>
          <span className="text-sm font-semibold">Preset decks</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {loaded ? decks.length : "Loading…"}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-3">
          {decks.length > 0 ? (
            <DeckShelfRow label="Preset decks">
              {decks.map((preset) => {
                const presetId = preset.id ?? preset.name;
                return (
                  <div key={`preset:${presetId}`} className={SHELF_CARD_CLASS}>
                    <DeckGridCard
                      deck={{ id: presetId, deck: preset, savedAt: 0 }}
                      onOpen={() => onOpenDeck(preset)}
                      onPlay={() => onPlayDeck(preset)}
                      badge="Official preset"
                      engines={preset.engines}
                      playing={pendingDeckId === presetId}
                      playDisabled={pendingDeckId !== null}
                      readOnly
                    />
                  </div>
                );
              })}
            </DeckShelfRow>
          ) : (
            <p className="px-2 text-xs italic text-muted-foreground">
              {loaded ? "No preset decks are available." : "Loading preset decks…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
