import { LibraryBig, Plus } from "lucide-react";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { DECK_SHELF_CARD_CLASS, DeckShelfRow } from "@/components/play/DeckShelfRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SavedDeck } from "@/stores/useDeckStore";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface OwnedDeckShelfProps {
  decks: SavedDeck[];
  lastPlayedDeckId: string | null;
  presetKeyByDeckId: Record<string, string | undefined>;
  pendingDeckId: string | null;
  onAddDeck: () => void;
  onOpenDeck: (deck: SavedDeck) => void;
  onPlayDeck: (deck: SavedDeck) => void;
  onViewPreset: (presetKey: string) => void;
}
export function OwnedDeckShelf({
  decks,
  lastPlayedDeckId,
  presetKeyByDeckId,
  pendingDeckId,
  onAddDeck,
  onOpenDeck,
  onPlayDeck,
  onViewPreset,
}: OwnedDeckShelfProps) {
  if (decks.length === 0) {
    return (
      <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-8 text-center">
        <LibraryBig className="mb-3 h-7 w-7 text-primary" />
        <p className="font-medium">
          <Trans>Your first deck is waiting to be brewed.</Trans>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>Build from scratch, import a decklist, or start with a preset below.</Trans>
        </p>
        <Button size="sm" className="mt-4" onClick={onAddDeck}>
          <Trans>
            <Plus className="h-4 w-4" />
            Build / Import
          </Trans>
        </Button>
      </div>
    );
  }
  return (
    <DeckShelfRow label={i18n._(msg`My decks`)}>
      {decks.map((deck) => {
        const presetKey = presetKeyByDeckId[deck.id];
        return (
          <div key={deck.id} className={cn(DECK_SHELF_CARD_CLASS, "relative")}>
            {deck.id === lastPlayedDeckId && (
              <span className="absolute right-1.5 top-1.5 z-20 rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary shadow-sm backdrop-blur-sm">
                <Trans>Last played</Trans>
              </span>
            )}
            <DeckGridCard
              deck={deck}
              onOpen={() => onOpenDeck(deck)}
              onPlay={() => onPlayDeck(deck)}
              onViewInHub={presetKey ? () => onViewPreset(presetKey) : undefined}
              badge={presetKey ? "Preset copy" : undefined}
              playing={pendingDeckId === deck.id}
              playDisabled={pendingDeckId !== null}
              readOnly
            />
          </div>
        );
      })}
    </DeckShelfRow>
  );
}
