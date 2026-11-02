import { useState } from "react";
import {
  CloudUpload,
  LibraryBig,
  MoreHorizontal,
  Pencil,
  Share2,
  Swords,
  Trash2,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="bg-background/80 backdrop-blur-sm hover:bg-background"
                  aria-label={`Actions for ${deck.deck.name}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onPlaytest && (
                  <DropdownMenuItem onSelect={onPlaytest}>
                    <Swords className="h-4 w-4" />
                    Playtest vs AI
                  </DropdownMenuItem>
                )}
                {onViewInHub && (
                  <DropdownMenuItem onSelect={onViewInHub}>
                    <LibraryBig className="h-4 w-4" />
                    View in Community
                  </DropdownMenuItem>
                )}
                {!readOnly && onPublish && (
                  <DropdownMenuItem onSelect={onPublish}>
                    <Share2 className="h-4 w-4" />
                    Publish to Community
                  </DropdownMenuItem>
                )}
                {!readOnly && onSaveToAccount && (
                  <DropdownMenuItem onSelect={onSaveToAccount}>
                    <CloudUpload className="h-4 w-4" />
                    Save to account
                  </DropdownMenuItem>
                )}
                {!readOnly && onRename && (
                  <DropdownMenuItem onSelect={onRename}>
                    <Pencil className="h-4 w-4" />
                    Rename
                  </DropdownMenuItem>
                )}
                {!readOnly && onDelete && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
              <span className="rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-ui-meta font-medium text-foreground backdrop-blur-sm">
                {badge}
              </span>
            )}
            {engines?.map((engine) => (
              <span
                key={engine}
                className="rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-ui-meta font-medium text-foreground backdrop-blur-sm"
              >
                {engine} engine
              </span>
            ))}
            <span className="ml-auto text-ui-meta text-text-on-tinted/85">
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
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
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
