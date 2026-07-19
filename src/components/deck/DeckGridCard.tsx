import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Pencil, Play, Share2, Swords, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedDeck } from "@/stores/useDeckStore";
import { DeckCoverImage } from "@/components/deck/deckCover";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import {
  DECK_NAME_SHADOW_CLASS,
  getDeckColorCost,
  getDeckNameColorClass,
} from "@/components/deck/deckDisplay.utils";

interface DeckGridCardProps {
  deck: SavedDeck;
  onOpen: () => void;
  onPlaytest?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  onPublish?: () => void;
  onPlay?: () => void;
  readOnly?: boolean;
}

export function DeckGridCard({
  deck,
  onOpen,
  onPlaytest,
  onDelete,
  onRename,
  onPublish,
  onPlay,
  readOnly = false,
}: DeckGridCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const displayCards = [...deck.deck.cards, ...(deck.deck.commanders ?? [])];
  const colorCost = getDeckColorCost(displayCards);
  const titleColorClass = getDeckNameColorClass(displayCards);
  const cover = resolveCoverCard(deck.deck);

  return (
    <>
      <div
        className={cn(
          "relative group cursor-pointer rounded-lg overflow-hidden border bg-muted",
          "aspect-[4/3] transition-all hover:ring-2 hover:ring-primary hover:border-primary",
        )}
        onClick={onOpen}
      >
        <DeckCoverImage cover={cover} alt={cover?.identity.name ?? deck.deck.name} />

        {/* Darkening overlay so bottom info is always readable */}
        <div className="absolute inset-0 bg-gradient-to-t from-overlay/80 via-overlay/20 to-overlay/10" />

        {onPlay && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute left-1.5 top-1.5 z-20 h-8 bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
          >
            <Play className="h-3.5 w-3.5" />
            Play
          </Button>
        )}

        {/* Action buttons — visible on hover */}
        {(onPlaytest || !readOnly) && (
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity z-10">
            {onPlaytest && (
              <Button
                size="icon"
                className="h-6 w-6"
                title="Playtest vs AI"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlaytest();
                }}
              >
                <Swords className="h-3 w-3" />
              </Button>
            )}
            {!readOnly && onPublish && (
              <Button
                size="icon"
                variant="secondary"
                className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background"
                title="Publish to Deck Hub"
                onClick={(e) => {
                  e.stopPropagation();
                  onPublish();
                }}
              >
                <Share2 className="h-3 w-3" />
              </Button>
            )}
            {!readOnly && onRename && (
              <Button
                size="icon"
                variant="secondary"
                className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename();
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            {!readOnly && onDelete && (
              <Button
                size="icon"
                variant="secondary"
                className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background text-destructive hover:text-destructive"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {/* Bottom info overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-2 pt-6 pb-2 z-10">
          <p
            className={cn(
              "text-text-on-tinted text-sm font-semibold truncate leading-tight",
              titleColorClass,
              DECK_NAME_SHADOW_CLASS,
            )}
          >
            {deck.deck.name}
          </p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <FormatBadge formatId={deck.deck.format ?? "standard"} />
            {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
            {deck.deck.labels?.map((label) => (
              <DeckLabelBadge key={label.name} label={label} size="sm" />
            ))}
            <span className="ml-auto text-[10px] text-text-on-tinted/85">
              {displayCards.length} cards
            </span>
          </div>
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Deck</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deck.deck.name}&rdquo;? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmDelete(false);
                onDelete?.();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
