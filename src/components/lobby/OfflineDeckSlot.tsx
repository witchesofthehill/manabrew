import { AlertCircle, Bot, Check, Loader2, Shuffle, Trash2, User, X } from "lucide-react";
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

const SLOT_ACTION_CLASS = "size-8 shrink-0 touch:size-11";

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
  const seatError = seat.deck ? error : undefined;
  return (
    <div
      className={cn(
        "flex h-full min-w-0 items-center gap-1 rounded-lg border bg-card pr-1",
        active && "border-selection-border bg-selection ring-1 ring-selection-border",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={active}
        aria-label={`Choose deck for ${assignment.label}`}
        title={seatError ?? seat.deck?.name}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-2 self-stretch rounded-l-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted touch:hidden">
          {seat.deck ? (
            <DeckCoverImage cover={resolveCoverCard(seat.deck.sourceDeck)} alt="" />
          ) : isPlayer ? (
            <User className="m-2.5 size-5 text-muted-foreground" />
          ) : (
            <Bot className="m-2.5 size-5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-ui-label font-semibold">
            <span className="shrink-0" style={{ color: assignment.color }}>
              {assignment.label}
            </span>
            {loading ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-label="Loading deck" />
            ) : seatError ? (
              <span className="flex min-w-0 items-center gap-1 text-ui-meta text-warning">
                <AlertCircle className="size-3.5 shrink-0" />
                <span className="truncate">{seatError}</span>
              </span>
            ) : active ? (
              <span className="truncate text-ui-meta text-selection-foreground">Selecting</span>
            ) : seat.deck ? (
              <Check className="size-3.5 shrink-0" />
            ) : null}
          </span>
          <span
            className={cn(
              "block truncate text-ui-meta",
              seat.deck ? "text-foreground" : "italic text-muted-foreground",
            )}
          >
            {seat.deck?.name ?? "Choose a deck"}
          </span>
        </span>
      </button>
      {seat.deck && (
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClear}
          aria-label={`Clear deck for ${assignment.label}`}
          title="Clear"
          className={SLOT_ACTION_CLASS}
        >
          <X className="size-3.5" />
        </Button>
      )}
      {!isPlayer && (
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled || !randomAvailable}
          onClick={onRandom}
          aria-label={`Random deck for ${assignment.label}`}
          title="Random deck"
          className={SLOT_ACTION_CLASS}
        >
          <Shuffle className="size-3.5" />
        </Button>
      )}
      {removable && (
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove ${assignment.label}`}
          title="Remove bot"
          className={SLOT_ACTION_CLASS}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
