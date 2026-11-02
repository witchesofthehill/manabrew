import { type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import {
  BOARD_BACKGROUNDS,
  boardBackgroundUrl,
  type BoardBackgroundId,
} from "@/pixi/board/boardBackgrounds";
import { cn } from "@/lib/utils";
import type { RoomPlayerInfo } from "@/types/server";

const SEATS: RoomPlayerInfo[] = [
  { username: "You", ready: true, connected: true },
  { username: "AI", ready: true, connected: true, is_bot: true },
];

interface TablePickerDialogProps {
  open: boolean;
  background: BoardBackgroundId;
  onBackgroundChange: (id: BoardBackgroundId) => void;
  onStart: () => void;
  onCancel: () => void;
  centerContent?: ReactNode;
  startLabel?: ReactNode;
  description?: ReactNode;
  players?: readonly RoomPlayerInfo[];
  maxPlayers?: number;
}

export function TablePickerDialog({
  open,
  background,
  onBackgroundChange,
  onStart,
  onCancel,
  centerContent,
  startLabel = "Fight",
  description = "The felt you'll play this game on.",
  players = SEATS,
  maxPlayers = 2,
}: TablePickerDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose your table</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex items-center justify-center rounded-xl border border-border bg-canvas-background p-3">
            <OpenTableSeats
              players={players}
              maxPlayers={maxPlayers}
              showSeatLabels
              youUsername="You"
              size="card"
              className="w-full max-w-none"
              backgroundUrl={boardBackgroundUrl(background)}
              centerContent={centerContent}
            />
          </div>
          <div className="grid grid-cols-3 content-start gap-2 rounded-xl border border-border bg-canvas-background p-3 sm:grid-cols-4">
            {BOARD_BACKGROUNDS.map((option) => {
              const isSelected = option.id === background;
              return (
                <button
                  key={option.id}
                  type="button"
                  title={option.label}
                  aria-pressed={isSelected}
                  onClick={() => onBackgroundChange(option.id)}
                  className={cn(
                    "overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-card-ring touch:min-h-11 touch:min-w-11 text-ui-label whitespace-normal",
                    isSelected
                      ? "border-card-selection ring-1 ring-card-selection"
                      : "border-text-muted/40 hover:border-card-ring",
                  )}
                >
                  {option.url ? (
                    <img
                      src={option.url}
                      alt=""
                      className="aspect-[16/9] w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex aspect-[16/9] w-full items-center justify-center bg-canvas-background text-ui-label text-text-muted">
                      None
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Back
          </Button>
          <Button variant="primary" onClick={onStart}>
            {startLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
