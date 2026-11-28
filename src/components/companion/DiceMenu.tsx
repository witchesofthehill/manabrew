import { useMemo, useState } from "react";
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
type Roll =
  | {
      kind: "die";
      sides: number;
    }
  | {
      kind: "coin";
    }
  | {
      kind: "first";
    };
interface DiceMenuProps {
  players: CompanionPlayer[];
}
export function DiceMenu({ players }: DiceMenuProps) {
  const pickRandom = useCompanionStore((s) => s.pickRandomFirstPlayer);
  const [roll, setRoll] = useState<Roll | null>(null);
  const eligiblePlayers = useMemo(() => players.filter((player) => !player.isDead), [players]);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 shrink-0 gap-1.5 px-2 touch:min-h-11 touch:min-w-11"
            aria-label={`Dice and randomizers`}
            title={`Dice, coin, random first player`}
          >
            <GameIcon icon="d20" className="size-4 sm:size-5" />
            <span className="hidden @min-[30rem]/companion-tracker:inline">Roll</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel>Roll</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {DICE.map((sides) => (
            <DropdownMenuItem key={sides} onSelect={() => setRoll({ kind: "die", sides })}>
              d{sides}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRoll({ kind: "coin" })}>Coin flip</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setRoll({ kind: "first" })}
            disabled={eligiblePlayers.length === 0}
          >
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
          players={eligiblePlayers}
          pickWinner={pickRandom}
        />
      )}
    </>
  );
}
