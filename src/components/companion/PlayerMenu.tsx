import { MoreVertical, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_ACCENT_COLORS,
  COMPANION_ACCENT_KEYS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";

interface PlayerMenuProps {
  player: CompanionPlayer;
  onPickCommander: () => void;
}

export function PlayerMenu({ player, onPickCommander }: PlayerMenuProps) {
  const toggleMonarch = useCompanionStore((s) => s.toggleMonarch);
  const toggleInitiative = useCompanionStore((s) => s.toggleInitiative);
  const toggleCityBlessing = useCompanionStore((s) => s.toggleCityBlessing);
  const setPlayerAccent = useCompanionStore((s) => s.setPlayerAccent);
  const markDead = useCompanionStore((s) => s.markDead);
  const resetCounters = useCompanionStore((s) => s.resetCounters);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full bg-black/40 text-white hover:bg-black/55 hover:text-white @md:size-7"
          aria-label="Player menu"
        >
          <MoreVertical className="size-3.5 @md:size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onPickCommander}>
          <GameIcon icon="crossed-swords" className="mr-2 size-4" /> Choose commander…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleMonarch(player.id)}>
          <GameIcon icon="crown" className="mr-2 size-4" />{" "}
          {player.isMonarch ? "Remove monarch" : "Mark monarch"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleInitiative(player.id)}>
          <GameIcon icon="checkered-flag" className="mr-2 size-4" />{" "}
          {player.hasInitiative ? "Remove initiative" : "Take initiative"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleCityBlessing(player.id)}>
          <GameIcon icon="fairy-wand" className="mr-2 size-4" />{" "}
          {player.hasCityBlessing ? "Lose city's blessing" : "Gain city's blessing"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Accent</DropdownMenuLabel>
        <div className="grid grid-cols-8 gap-1 px-2 pb-2">
          {COMPANION_ACCENT_KEYS.map((key) => (
            <button
              type="button"
              key={key}
              onClick={() => setPlayerAccent(player.id, key)}
              className={cn(
                "size-5 rounded-full border-2",
                key === player.accentKey ? "border-foreground" : "border-transparent",
              )}
              style={{ backgroundColor: COMPANION_ACCENT_COLORS[key] }}
              aria-label={`Accent ${key}`}
            />
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => resetCounters("all", player.id)}>
          Reset this player
        </DropdownMenuItem>
        {player.isDead ? (
          <DropdownMenuItem onSelect={() => markDead(player.id, false)}>
            <UserPlus className="mr-2 size-4" /> Revive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => markDead(player.id, true)}>
            <UserMinus className="mr-2 size-4" /> Eliminate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
