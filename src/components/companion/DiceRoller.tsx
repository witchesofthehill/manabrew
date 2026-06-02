import { useEffect, useState } from "react";
import { GameIcon } from "./GameIcon";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COMPANION_ACCENT_COLORS } from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";

interface DiceRollerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: CompanionPlayer[];
  /** Returns the winning player id (committed to the store). */
  pickWinner: () => string | null;
}

export function DiceRoller({ open, onOpenChange, players, pickWinner }: DiceRollerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GameIcon icon="d20" className="size-5" /> Randomising first player…
          </DialogTitle>
        </DialogHeader>
        {open && <DiceAnimation players={players} pickWinner={pickWinner} />}
      </DialogContent>
    </Dialog>
  );
}

function DiceAnimation({
  players,
  pickWinner,
}: {
  players: CompanionPlayer[];
  pickWinner: () => string | null;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (players.length === 0) return;

    let ticks = 0;
    const maxTicks = 14;
    const interval = setInterval(() => {
      ticks += 1;
      const idx = Math.floor(Math.random() * players.length);
      setHighlight(players[idx]!.id);
      if (ticks >= maxTicks) {
        clearInterval(interval);
        const winnerId = pickWinner();
        if (winnerId) {
          setHighlight(winnerId);
          setSettled(true);
        }
      }
    }, 90);

    return () => clearInterval(interval);
  }, [players, pickWinner]);

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {players.map((player) => {
          const accent = COMPANION_ACCENT_COLORS[player.accentKey];
          const active = highlight === player.id;
          return (
            <div
              key={player.id}
              className={cn(
                "flex items-center gap-2 rounded-md border-2 p-3 text-sm font-semibold text-white transition",
                active ? "scale-105 border-white" : "border-transparent",
              )}
              style={{ backgroundColor: accent }}
            >
              {player.name}
            </div>
          );
        })}
      </div>
      {settled && highlight && (
        <p className="text-center text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {players.find((p) => p.id === highlight)?.name}
          </span>{" "}
          goes first.
        </p>
      )}
    </>
  );
}
