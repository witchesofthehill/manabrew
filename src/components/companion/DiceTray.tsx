import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DiceRoller } from "./DiceRoller";
import { GameIcon } from "./GameIcon";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
type Roll =
  | {
      kind: "die";
      sides: number;
    }
  | {
      kind: "coin";
    };
export function DiceTray() {
  const [roll, setRoll] = useState<Roll | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="size-8 sm:size-9"
            aria-label={i18n._(msg`Dice tray`)}
            title={i18n._(msg`Dice & coin`)}
          >
            <GameIcon icon="d20" className="size-4 sm:size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuLabel>
            <Trans>Roll</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {DICE.map((sides) => (
            <DropdownMenuItem key={sides} onSelect={() => setRoll({ kind: "die", sides })}>
              <Trans>d{sides}</Trans>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRoll({ kind: "coin" })}>
            <Trans>Coin flip</Trans>
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
    </>
  );
}
