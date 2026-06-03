import { useState } from "react";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { DiceRoller } from "./DiceRoller";
import { GameIcon } from "./GameIcon";

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

type Roll = { kind: "die"; sides: number } | { kind: "coin" } | { kind: "first" };

interface DiceMenuProps {
  players: CompanionPlayer[];
}

/**
 * Single-entry-point dice control: d4 / d6 / d8 / d10 / d12 / d20 / d100,
 * coin flip, and random first player all live behind one d20 dropdown
 * trigger. Each selection opens the shared DiceRoller modal in the
 * matching mode.
 */
export function DiceMenu({ players }: DiceMenuProps) {
  const pickRandom = useCompanionStore((s) => s.pickRandomFirstPlayer);
  const [roll, setRoll] = useState<Roll | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="size-8 sm:size-9"
            aria-label="Dice and randomizers"
            title="Dice, coin, random first player"
          >
            <GameIcon icon="d20" className="size-4 sm:size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel>Roll</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {DICE.map((sides) => (
            <DropdownMenuItem key={sides} onSelect={() => setRoll({ kind: "die", sides })}>
              d{sides}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRoll({ kind: "coin" })}>Coin flip</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRoll({ kind: "first" })}>
            <Shuffle className="mr-2 size-4" /> Random first player
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {roll?.kind === "die" && (
        <DiceRoller
          mode="die"
          sides={roll.sides}
          open
          onOpenChange={(open) => !open && setRoll(null)}
        />
      )}
      {roll?.kind === "coin" && (
        <DiceRoller mode="coin" open onOpenChange={(open) => !open && setRoll(null)} />
      )}
      {roll?.kind === "first" && (
        <DiceRoller
          open
          onOpenChange={(open) => !open && setRoll(null)}
          players={players}
          pickWinner={pickRandom}
        />
      )}
    </>
  );
}
