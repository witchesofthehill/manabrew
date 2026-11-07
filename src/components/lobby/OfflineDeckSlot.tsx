import { Bot, Check, Loader2, Shuffle, User, X } from "lucide-react";
import { DeckCoverImage } from "@/components/deck/deckCover";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DeckAssignment } from "./deckSelection.types";
import { PLAYER_SEAT_ID, type OfflineSeat } from "./offlineRoster.state";

interface OfflineDeckSlotProps {
  seat: OfflineSeat;
  assignment: DeckAssignment;
  active: boolean;
  loading: boolean;
  disabled: boolean;
  removable: boolean;
  randomAvailable: boolean;
  error?: string;
  onSelect: () => void;
  onClear: () => void;
  onRemove: () => void;
  onRandom: () => void;
}

export function OfflineDeckSlot({
  seat,
  assignment,
  active,
  loading,
  disabled,
  removable,
  randomAvailable,
  error,
  onSelect,
  onClear,
  onRemove,
  onRandom,
}: OfflineDeckSlotProps) {
  const isPlayer = seat.id === PLAYER_SEAT_ID;
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card",
        active && "border-selection-border bg-selection ring-1 ring-selection-border",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={active}
        aria-label={`Choose deck for ${assignment.label}`}
        className="flex min-h-16 w-full min-w-0 items-center gap-2 rounded-t-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 touch:min-h-11"
      >
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
          {seat.deck ? (
            <DeckCoverImage cover={resolveCoverCard(seat.deck.sourceDeck)} alt="" />
          ) : isPlayer ? (
            <User className="m-3 size-6 text-muted-foreground" />
          ) : (
            <Bot className="m-3 size-6 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-ui-label font-semibold">
            <span style={{ color: assignment.color }}>{assignment.label}</span>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-label="Loading deck" />
            ) : active ? (
              <span className="text-ui-meta text-selection-foreground">Selecting</span>
            ) : seat.confirmed && !error ? (
              <Check className="size-3.5" />
            ) : seat.deck && !seat.confirmed ? (
              <span className="text-ui-meta text-muted-foreground">Suggested</span>
            ) : null}
          </span>
          <span className="block break-words text-ui-meta text-foreground">
            {seat.deck?.name ?? "Choose a deck"}
          </span>
        </span>
      </button>
      {seat.deck && error && (
        <p className="px-2 pb-1 text-ui-meta text-warning" role="status">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1 border-t px-1 py-1">
        {seat.deck && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onClear}
            aria-label={`Clear deck for ${assignment.label}`}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        {!isPlayer && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || !randomAvailable}
            onClick={onRandom}
            aria-label={`Random deck for ${assignment.label}`}
          >
            <Shuffle className="size-3.5" />
            Random
          </Button>
        )}
        {removable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${assignment.label}`}
            className="ml-auto"
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
