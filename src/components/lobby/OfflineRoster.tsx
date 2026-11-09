import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DeckAssignment } from "./deckSelection.types";
import { OfflineDeckSlot } from "./OfflineDeckSlot";
import { MAX_OFFLINE_BOTS, type OfflineRosterState } from "./offlineRoster.state";

interface OfflineRosterProps {
  roster: OfflineRosterState;
  assignments: DeckAssignment[];
  errors: (string | undefined)[];
  loadingSeatId: string | null;
  multiplayer: boolean;
  compact: boolean;
  disabled: boolean;
  randomAvailable: boolean;
  onSelect: (seatId: string) => void;
  onClear: (seatId: string) => void;
  onRemove: (seatId: string) => void;
  onRandom: (seatId: string) => void;
  onAdd: () => void;
}

export function OfflineRoster({
  roster,
  assignments,
  errors,
  loadingSeatId,
  multiplayer,
  compact,
  disabled,
  randomAvailable,
  onSelect,
  onClear,
  onRemove,
  onRandom,
  onAdd,
}: OfflineRosterProps) {
  return (
    <div
      className={cn(
        "min-w-0 gap-2 xl:flex-1",
        compact ? "flex overflow-x-auto pb-1" : "grid grid-cols-2 xl:flex",
      )}
    >
      {roster.seats.map((seat, index) => (
        <div key={seat.id} className={cn("min-w-0", compact ? "w-52 shrink-0" : "xl:flex-1")}>
          <OfflineDeckSlot
            seat={seat}
            assignment={assignments[index]}
            active={roster.activeSeatId === seat.id}
            loading={loadingSeatId === seat.id}
            disabled={disabled}
            removable={index > 0 && roster.seats.length > 2}
            randomAvailable={randomAvailable}
            error={errors[index]}
            onSelect={() => onSelect(seat.id)}
            onClear={() => onClear(seat.id)}
            onRemove={() => onRemove(seat.id)}
            onRandom={() => onRandom(seat.id)}
          />
        </div>
      ))}
      {multiplayer && roster.seats.length - 1 < MAX_OFFLINE_BOTS && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={onAdd}
          className="h-auto min-h-16 shrink-0 gap-2 border-dashed px-4 xl:w-28"
        >
          <Plus className="size-4" />
          Add bot
        </Button>
      )}
    </div>
  );
}
