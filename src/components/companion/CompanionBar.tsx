import { useState } from "react";
import { Minus, Plus, Redo2, RotateCcw, Undo2, XOctagon } from "lucide-react";
import { GameIcon } from "./GameIcon";
import { LayoutIcon } from "./LayoutIcon";
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
  COMPANION_LAYOUT_LABELS,
  COMPANION_LAYOUT_OPTIONS,
  COMPANION_MAX_PLAYERS,
  COMPANION_MIN_PLAYERS,
  COMPANION_STARTING_LIFE_PRESETS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionSession } from "@/stores/useCompanionStore.types";
import { DiceRoller } from "./DiceRoller";
import { TurnTimer } from "./TurnTimer";

interface CompanionBarProps {
  session: CompanionSession;
  onOpenNewSession: () => void;
}

export function CompanionBar({ session, onOpenNewSession }: CompanionBarProps) {
  const setLayout = useCompanionStore((s) => s.setLayout);
  const setPlayerCount = useCompanionStore((s) => s.setPlayerCount);
  const setStartingLife = useCompanionStore((s) => s.setStartingLife);
  const setCommanderRules = useCompanionStore((s) => s.setCommanderRules);
  const undo = useCompanionStore((s) => s.undo);
  const resetCounters = useCompanionStore((s) => s.resetCounters);
  const endSession = useCompanionStore((s) => s.endSession);
  const pickRandom = useCompanionStore((s) => s.pickRandomFirstPlayer);

  const [diceOpen, setDiceOpen] = useState(false);

  const layoutChoices = COMPANION_LAYOUT_OPTIONS[session.players.length] ?? ["free"];

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card/70 px-2 py-1.5 backdrop-blur sm:gap-2 sm:px-3 sm:py-2">
      <Button
        size="sm"
        onClick={onOpenNewSession}
        className="h-8 px-2 text-xs sm:h-9 sm:px-4 sm:text-sm"
      >
        <span className="sm:hidden">New</span>
        <span className="hidden sm:inline">New game</span>
      </Button>

      <div className="flex items-center gap-0.5 rounded-md bg-muted/60 px-1 py-0.5 sm:gap-1 sm:px-1.5 sm:py-1">
        <span className="hidden text-xs text-muted-foreground sm:inline">Players</span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          onClick={() => setPlayerCount(session.players.length - 1)}
          disabled={session.players.length <= COMPANION_MIN_PLAYERS}
          aria-label="Fewer players"
        >
          <Minus className="size-3.5" />
        </Button>
        <span className="min-w-4 text-center tabular-nums text-sm font-semibold">
          {session.players.length}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          onClick={() => setPlayerCount(session.players.length + 1)}
          disabled={session.players.length >= COMPANION_MAX_PLAYERS}
          aria-label="More players"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
          >
            <span className="hidden sm:inline">Life:</span>
            <span className="tabular-nums font-semibold">{session.startingLife}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Starting life</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {COMPANION_STARTING_LIFE_PRESETS.map((value) => (
            <DropdownMenuItem
              key={value}
              onSelect={() => setStartingLife(value)}
              className={cn(value === session.startingLife && "bg-accent")}
            >
              {value}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="sm"
        variant={session.commanderRules ? "default" : "outline"}
        onClick={() => setCommanderRules(!session.commanderRules)}
        className="h-8 gap-1 px-2 sm:h-9 sm:px-3"
        aria-label="Toggle commander rules"
        title="Commander rules"
      >
        <GameIcon icon="crown" className="size-3.5" />
        <span className="hidden sm:inline">Commander</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
            aria-label={`Layout: ${COMPANION_LAYOUT_LABELS[session.layout]}`}
            title={`Layout: ${COMPANION_LAYOUT_LABELS[session.layout]}`}
          >
            <LayoutIcon layout={session.layout} className="size-4" />
            <span className="hidden sm:inline">{COMPANION_LAYOUT_LABELS[session.layout]}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {layoutChoices.map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => setLayout(option)}
              className={cn("gap-2", option === session.layout && "bg-accent")}
            >
              <LayoutIcon layout={option} className="size-5" />
              {COMPANION_LAYOUT_LABELS[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex flex-wrap items-center gap-1 sm:gap-2">
        <TurnTimer />
        <Button
          size="icon"
          variant="outline"
          onClick={() => setDiceOpen(true)}
          className="size-8 sm:size-9"
          aria-label="Random first player"
          title="Random first player"
        >
          <GameIcon icon="d20" className="size-4 sm:size-5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={undo}
          aria-label="Undo last action"
          title="Undo last action"
        >
          <Undo2 className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8" aria-label="More actions">
              <RotateCcw className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Reset</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => resetCounters("life")}>
              <Redo2 className="mr-2 size-4" /> Life only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => resetCounters("counters")}>
              <Redo2 className="mr-2 size-4" /> Counters only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => resetCounters("commander-damage")}>
              <Redo2 className="mr-2 size-4" /> Commander damage
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => resetCounters("all")}>
              Reset everything
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-destructive hover:text-destructive"
          onClick={() => endSession()}
          aria-label="End game"
          title="End game"
        >
          <XOctagon className="size-4" />
        </Button>
      </div>

      <DiceRoller
        open={diceOpen}
        onOpenChange={setDiceOpen}
        players={session.players}
        pickWinner={pickRandom}
      />
    </div>
  );
}
