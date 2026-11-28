import { useId, useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, RotateCw } from "lucide-react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { COMPANION_ACCENT_COLORS } from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { turnOrderFrom } from "./layouts/turnOrder";

const DIRECTIONS = [
  { label: "Clockwise", reverse: false, Icon: RotateCw },
  { label: "Counterclockwise", reverse: true, Icon: RotateCcw },
];

interface StartGameDialogProps {
  players: CompanionPlayer[];
  clockwiseSeats: string[];
  arrangeGrid: boolean;
  onStart: (order: string[], counterclockwise: boolean) => void;
  onClose: () => void;
  returnFocus: () => void;
}

export function StartGameDialog({
  players,
  clockwiseSeats,
  arrangeGrid,
  onStart,
  onClose,
  returnFocus,
}: StartGameDialogProps) {
  const directionName = useId();
  const living = players.filter((player) => !player.isDead);
  const [order, setOrder] = useState(() => {
    const playersById = new Map(living.map((player) => [player.id, player]));
    return turnOrderFrom(
      clockwiseSeats.filter((id) => playersById.has(id)),
      living[0]!.id,
    ).map((id) => playersById.get(id)!);
  });
  const [counterclockwise, setCounterclockwise] = useState(false);
  const first = order[0];

  function chooseFirst(id: string) {
    setOrder((current) => {
      const index = current.findIndex((player) => player.id === id);
      return [...current.slice(index), ...current.slice(0, index)];
    });
  }

  function changeDirection(reverse: boolean) {
    setCounterclockwise(reverse);
    setOrder((current) => turnOrderFrom(current, current[0]!, true));
  }

  function move(index: number, offset: -1 | 1) {
    const nextIndex = index + offset;
    if (nextIndex < 1 || nextIndex >= order.length) return;
    const next = [...order];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    setOrder(next);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-modal-panel
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Start game</DialogTitle>
          <DialogDescription>
            {arrangeGrid
              ? "Grid seats follow this list in the chosen direction. The first player keeps their seat."
              : "Change the direction or reorder the list without moving seats."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <div className="text-ui-label font-semibold">Who goes first?</div>
          <AppSelect
            aria-label={`Who goes first? ${first?.name ?? ""}`}
            value={first?.id ?? ""}
            onValueChange={chooseFirst}
          >
            {living.map((player) => (
              <AppSelectOption key={player.id} value={player.id}>
                {player.name}
              </AppSelectOption>
            ))}
          </AppSelect>
        </div>
        {order.length > 2 && (
          <fieldset>
            <legend className="mb-2 text-ui-label font-semibold">Direction</legend>
            <div className="inline-flex gap-0.5 rounded-md border border-border bg-muted p-0.5">
              {DIRECTIONS.map(({ label, reverse, Icon }) => (
                <label key={label} className="cursor-pointer" title={label}>
                  <input
                    type="radio"
                    name={directionName}
                    aria-label={label}
                    className="peer sr-only"
                    checked={counterclockwise === reverse}
                    onChange={() => changeDirection(reverse)}
                  />
                  <span className="grid size-9 place-items-center rounded-sm border border-transparent text-muted-foreground hover:text-foreground peer-checked:border-selection-border peer-checked:bg-selection peer-checked:text-selection-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring touch:size-11">
                    <Icon className="size-5" aria-hidden />
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <div className="text-ui-label font-semibold">Turn order</div>
          <ol className="mt-1 divide-y divide-border" aria-label="Turn order">
            {order.map((player, index) => (
              <li key={player.id} className="flex min-h-11 items-center gap-2 py-1">
                <span
                  className="w-4 shrink-0 text-right text-ui-meta tabular-nums text-muted-foreground"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: COMPANION_ACCENT_COLORS[player.accentKey] }}
                />
                <span className="min-w-0 flex-1 break-words">{player.name}</span>
                {index === 0 ? (
                  <span className="text-ui-meta text-muted-foreground">Goes first</span>
                ) : order.length > 2 ? (
                  <div className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="aria-disabled:opacity-50"
                      aria-label={`Move ${player.name} earlier`}
                      aria-disabled={index === 1}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="aria-disabled:opacity-50"
                      aria-label={`Move ${player.name} later`}
                      aria-disabled={index === order.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!first}
            onClick={() =>
              onStart(
                order.map((player) => player.id),
                counterclockwise,
              )
            }
          >
            Start game
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
