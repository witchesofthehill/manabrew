import { useState } from "react";
import { ChevronRight, MoreHorizontal, Redo2, Shuffle, Undo2, XOctagon } from "lucide-react";
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
  COMPANION_ACCENT_COLORS,
  COMPANION_LAYOUT_LABELS,
  COMPANION_LAYOUT_OPTIONS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionSession } from "@/stores/useCompanionStore.types";
import { DiceRoller } from "./DiceRoller";
import { FocusModeButton } from "./FocusModeButton";
import { GameLog } from "./GameLog";
import { SetupMenu } from "./SetupMenu";
import { TurnTimer } from "./TurnTimer";

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

interface CompanionBarProps {
  session: CompanionSession;
  onOpenNewSession: () => void;
  focus: boolean;
  onToggleFocus: (next: boolean) => void;
}

type Roll = { kind: "die"; sides: number } | { kind: "coin" } | { kind: "first" };

export function CompanionBar({
  session,
  onOpenNewSession,
  focus,
  onToggleFocus,
}: CompanionBarProps) {
  const setLayout = useCompanionStore((s) => s.setLayout);
  const undo = useCompanionStore((s) => s.undo);
  const redo = useCompanionStore((s) => s.redo);
  const canRedo = useCompanionStore((s) => (s.session?.redoStack.length ?? 0) > 0);
  const advanceTurn = useCompanionStore((s) => s.advanceTurn);
  const resetCounters = useCompanionStore((s) => s.resetCounters);
  const resetGame = useCompanionStore((s) => s.resetGame);
  const endSession = useCompanionStore((s) => s.endSession);
  const pickRandom = useCompanionStore((s) => s.pickRandomFirstPlayer);

  const activePlayer = session.players.find((p) => p.id === session.activePlayerId) ?? null;
  const [roll, setRoll] = useState<Roll | null>(null);

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

      <SetupMenu session={session} />

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
        <Button
          size="sm"
          variant={activePlayer ? "default" : "outline"}
          onClick={advanceTurn}
          className="h-8 gap-1 px-2 text-xs text-white shadow-sm sm:h-9 sm:px-3 sm:text-sm"
          style={
            activePlayer
              ? { backgroundColor: COMPANION_ACCENT_COLORS[activePlayer.accentKey] }
              : undefined
          }
          aria-label="Next turn"
          title={activePlayer ? `Turn ${session.turn} · ${activePlayer.name}` : "Start turn"}
        >
          <ChevronRight className="size-3.5" />
          <span className="hidden tabular-nums sm:inline">
            {activePlayer ? `T${session.turn} · ${activePlayer.name}` : "Start"}
          </span>
          <span className="tabular-nums sm:hidden">T{session.turn}</span>
        </Button>

        <TurnTimer />

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
            <DropdownMenuItem onSelect={() => setRoll({ kind: "coin" })}>
              Coin flip
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRoll({ kind: "first" })}>
              <Shuffle className="mr-2 size-4" /> Random first player
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <GameLog session={session} />

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
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={redo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo"
        >
          <Redo2 className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Reset</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => resetCounters("life")}>Life only</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => resetCounters("counters")}>
              Counters only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => resetCounters("commander-damage")}>
              Commander damage
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => resetGame()}>
              Reset everything (turn, timer, history)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => endSession()}
              className="text-destructive focus:text-destructive"
            >
              <XOctagon className="mr-2 size-4" /> End game
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <FocusModeButton focus={focus} onToggle={onToggleFocus} />
      </div>

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
          players={session.players}
          pickWinner={pickRandom}
        />
      )}
    </div>
  );
}
