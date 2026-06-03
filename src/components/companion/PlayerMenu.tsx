import { useEffect, useRef, useState } from "react";
import { Flag, MoreVertical, NotebookPen, PlayCircle, UserMinus, UserPlus } from "lucide-react";
import { PlayerNotesDialog } from "./PlayerNotesDialog";
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
import { manaSymbolUrl } from "@/api/scryfall";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_ACCENT_COLORS,
  COMPANION_ACCENT_KEYS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { MANA_COLORS } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";

interface PlayerMenuProps {
  player: CompanionPlayer;
  onPickCommander: () => void;
}

export function PlayerMenu({ player, onPickCommander }: PlayerMenuProps) {
  const toggleMonarch = useCompanionStore((s) => s.toggleMonarch);
  const toggleInitiative = useCompanionStore((s) => s.toggleInitiative);
  const toggleCityBlessing = useCompanionStore((s) => s.toggleCityBlessing);
  const cycleRing = useCompanionStore((s) => s.cycleRing);
  const cycleSpeed = useCompanionStore((s) => s.cycleSpeed);
  const adjustMana = useCompanionStore((s) => s.adjustMana);
  const clearMana = useCompanionStore((s) => s.clearMana);
  const setFirstPlayer = useCompanionStore((s) => s.setFirstPlayer);
  const isFirstPlayer = useCompanionStore((s) => s.session?.lastFirstPlayerId === player.id);
  const setPlayerAccent = useCompanionStore((s) => s.setPlayerAccent);
  const markDead = useCompanionStore((s) => s.markDead);
  const resetCounters = useCompanionStore((s) => s.resetCounters);
  const [pendingConcede, setPendingConcede] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const concedeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (concedeTimerRef.current) clearTimeout(concedeTimerRef.current);
    },
    [],
  );
  const handleConcede = (event: Event) => {
    if (!pendingConcede) {
      event.preventDefault();
      setPendingConcede(true);
      concedeTimerRef.current = setTimeout(() => setPendingConcede(false), 3000);
      return;
    }
    if (concedeTimerRef.current) clearTimeout(concedeTimerRef.current);
    setPendingConcede(false);
    markDead(player.id, true);
  };

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
        <DropdownMenuItem onSelect={() => setFirstPlayer(player.id)} disabled={isFirstPlayer}>
          <PlayCircle className="mr-2 size-4" />{" "}
          {isFirstPlayer ? "Goes first" : "Set as first player"}
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
        <DropdownMenuItem onSelect={() => cycleRing(player.id)}>
          <GameIcon icon="magic-portal" className="mr-2 size-4" /> The Ring tempts you (
          {player.ringLevel ?? 0}/4)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => cycleSpeed(player.id)}>
          <GameIcon icon="lightning-trio" className="mr-2 size-4" /> Speed ({player.speed ?? 0}/4)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Floating mana</DropdownMenuLabel>
        <div className="grid grid-cols-6 gap-1 px-2 pb-2">
          {MANA_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              onClick={() => adjustMana(player.id, color, 1)}
              className="grid size-7 place-items-center rounded-md hover:bg-accent"
              aria-label={`Add ${color} mana`}
            >
              <img src={manaSymbolUrl(color)} alt="" className="size-4" draggable={false} />
            </button>
          ))}
        </div>
        <DropdownMenuItem onSelect={() => clearMana(player.id)}>Empty mana pool</DropdownMenuItem>
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
        <DropdownMenuItem onSelect={() => setNotesOpen(true)}>
          <NotebookPen className="mr-2 size-4" /> Notes
          {player.notes ? "…" : ""}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => resetCounters("all", player.id)}>
          Reset this player
        </DropdownMenuItem>
        {player.isDead ? (
          <DropdownMenuItem onSelect={() => markDead(player.id, false)}>
            <UserPlus className="mr-2 size-4" /> Revive
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={handleConcede}
              className={pendingConcede ? "text-destructive" : undefined}
            >
              <Flag className="mr-2 size-4" /> {pendingConcede ? "Tap again to concede" : "Concede"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => markDead(player.id, true)}>
              <UserMinus className="mr-2 size-4" /> Eliminate
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      <PlayerNotesDialog open={notesOpen} onOpenChange={setNotesOpen} player={player} />
    </DropdownMenu>
  );
}
