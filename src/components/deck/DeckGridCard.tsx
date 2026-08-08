import { useState } from "react";
import { CloudUpload, LibraryBig, Pencil, Share2, Swords, Trash2 } from "lucide-react";
import { DeckCardSurface } from "@/components/deck/DeckCardSurface";
import { DeckCardPlayButton } from "@/components/deck/DeckCardPlayButton";
import { DeckCoverImage } from "@/components/deck/deckCover";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { getDeckColorCost, getDeckNameColorClass } from "@/components/deck/deckDisplay.utils";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EngineKind } from "@/protocol";
import type { SavedDeck } from "@/stores/useDeckStore";

interface DeckGridCardProps {
  deck: SavedDeck;
  onOpen: () => void;
  onPlaytest?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  onPublish?: () => void;
  onSaveToAccount?: () => void;
  onViewInHub?: () => void;
  onPlay?: () => void;
  badge?: string;
  engines?: EngineKind[];
  playing?: boolean;
  playDisabled?: boolean;
  readOnly?: boolean;
}

export function DeckGridCard({
  deck,
  onOpen,
  onPlaytest,
  onDelete,
  onRename,
  onPublish,
  onSaveToAccount,
  onViewInHub,
  onPlay,
  badge,
  engines,
  playing = false,
  playDisabled = false,
  readOnly = false,
}: DeckGridCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const displayCards = [...deck.deck.cards, ...(deck.deck.commanders ?? [])];
  const colorCost = getDeckColorCost(displayCards);
  const titleColorClass = getDeckNameColorClass(displayCards);
  const cover = resolveCoverCard(deck.deck);
  const actionsVisible = onPlaytest || onViewInHub || !readOnly;

  return (
    <>
      <DeckCardSurface
        title={deck.deck.name}
        ariaLabel={`Open ${deck.deck.name}`}
        onOpen={onOpen}
        titleClassName={titleColorClass}
        cover={<DeckCoverImage cover={cover} alt={cover?.identity.name ?? deck.deck.name} />}
        topLeft={
          onPlay ? (
            <DeckCardPlayButton playing={playing} disabled={playDisabled} onPlay={onPlay} />
          ) : undefined
        }
        topRight={
          actionsVisible ? (
            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
              {onPlaytest && (
                <Button
                  size="icon"
                  className="h-6 w-6"
                  aria-label="Playtest vs AI"
                  title="Playtest vs AI"
                  onClick={onPlaytest}
                >
                  <Swords className="h-3 w-3" />
                </Button>
              )}
              {onViewInHub && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background"
                  aria-label="View in Community"
                  title="View in Community"
                  onClick={onViewInHub}
                >
                  <LibraryBig className="h-3 w-3" />
                </Button>
              )}
              {!readOnly && onPublish && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background"
                  aria-label="Publish to Community"
                  title="Publish to Community"
                  onClick={onPublish}
                >
                  <Share2 className="h-3 w-3" />
                </Button>
              )}
              {!readOnly && onSaveToAccount && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background"
                  aria-label="Save to account"
                  title="Save to account"
                  onClick={onSaveToAccount}
                >
                  <CloudUpload className="h-3 w-3" />
                </Button>
              )}
              {!readOnly && onRename && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background"
                  aria-label="Rename"
                  title="Rename"
                  onClick={onRename}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              {!readOnly && onDelete && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-6 w-6 bg-background/80 text-destructive backdrop-blur-sm hover:bg-background hover:text-destructive"
                  aria-label="Delete"
                  title="Delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ) : undefined
        }
        footer={
          <>
            <FormatBadge formatId={deck.deck.format ?? "standard"} />
            {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
            {deck.deck.labels?.map((label) => (
              <DeckLabelBadge key={label.name} label={label} size="sm" />
            ))}
            {badge && (
              <span className="rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-[9px] font-medium text-foreground backdrop-blur-sm">
                {badge}
              </span>
            )}
            {engines?.map((engine) => (
              <span
                key={engine}
                className="rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-[9px] font-medium text-foreground backdrop-blur-sm"
              >
                {engine} engine
              </span>
            ))}
            <span className="ml-auto text-[10px] text-text-on-tinted/85">
              {displayCards.length} cards
            </span>
          </>
        }
      />

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
