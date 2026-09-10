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
}

export function TablePickerDialog({
  open,
  background,
  onBackgroundChange,
  onStart,
  onCancel,
  centerContent,
}: TablePickerDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose your table</DialogTitle>
          <DialogDescription>The felt you'll play this game on.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex items-center justify-center sm:pr-2">
            <OpenTableSeats
              players={SEATS}
              maxPlayers={2}
              showSeatLabels
              youUsername="You"
              size="card"
              className="w-full max-w-none"
              backgroundUrl={boardBackgroundUrl(background)}
              centerContent={centerContent}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 content-start sm:grid-cols-4">
            {BOARD_BACKGROUNDS.map((option) => {
              const isSelected = option.id === background;
              return (
                <button
                  key={option.id}
                  type="button"
                  title={option.label}
                  onClick={() => onBackgroundChange(option.id)}
                  className={cn(
                    "overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isSelected
                      ? "border-primary ring-1 ring-primary"
                      : "border-border/70 hover:border-primary/50",
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
                    <span className="flex aspect-[16/9] w-full items-center justify-center bg-canvas-background text-[10px] text-muted-foreground">
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
          <Button onClick={onStart}>Fight</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
