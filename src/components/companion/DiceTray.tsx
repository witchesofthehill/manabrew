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
import { GameIcon } from "./GameIcon";

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

export function DiceTray() {
  const [last, setLast] = useState<{ label: string; value: number | string } | null>(null);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setLast(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="size-8 sm:size-9"
          aria-label="Dice tray"
          title="Dice & coin"
        >
          <GameIcon icon="d20" className="size-4 sm:size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Roll</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DICE.map((sides) => (
          <DropdownMenuItem
            key={sides}
            onSelect={(e) => {
              e.preventDefault();
              const value = 1 + Math.floor(Math.random() * sides);
              setLast({ label: `d${sides}`, value });
            }}
          >
            d{sides}
            {last?.label === `d${sides}` && (
              <span className="ml-auto font-semibold tabular-nums">{last.value}</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setLast({ label: "coin", value: Math.random() < 0.5 ? "Heads" : "Tails" });
          }}
        >
          Coin flip
          {last?.label === "coin" && <span className="ml-auto font-semibold">{last.value}</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
