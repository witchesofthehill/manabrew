import { ListOrdered, Minus, Plus, RotateCcw, Settings, XOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_MAX_PLAYERS,
  COMPANION_MIN_PLAYERS,
  COMPANION_STARTING_LIFE_PRESETS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionSession } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";

interface SetupMenuProps {
  session: CompanionSession;
  onOpenLog: () => void;
}

/**
 * Collapses every "rarely touched once the game starts" control into one
 * dropdown: player count, starting life, commander rules, oathbreaker,
 * day/night cycle, timer mode, session tag. Keeps the inline bar
 * focused on actions you actually take every turn.
 */
export function SetupMenu({ session, onOpenLog }: SetupMenuProps) {
  const setPlayerCount = useCompanionStore((s) => s.setPlayerCount);
  const setStartingLife = useCompanionStore((s) => s.setStartingLife);
  const setCommanderRules = useCompanionStore((s) => s.setCommanderRules);
  const setTimerMode = useCompanionStore((s) => s.setTimerMode);
  const setSessionTag = useCompanionStore((s) => s.setSessionTag);
  const resetCounters = useCompanionStore((s) => s.resetCounters);
  const resetGame = useCompanionStore((s) => s.resetGame);
  const endSession = useCompanionStore((s) => s.endSession);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="size-8 sm:size-9"
          aria-label="Game setup"
          title="Game setup"
        >
          <Settings className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Players</DropdownMenuLabel>
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            onClick={() => setPlayerCount(session.players.length - 1)}
            disabled={session.players.length <= COMPANION_MIN_PLAYERS}
            aria-label="Fewer players"
          >
            <Minus className="size-3.5" />
          </Button>
          <span className="text-sm font-semibold tabular-nums">{session.players.length}</span>
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            onClick={() => setPlayerCount(session.players.length + 1)}
            disabled={session.players.length >= COMPANION_MAX_PLAYERS}
            aria-label="More players"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Starting life</DropdownMenuLabel>
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {COMPANION_STARTING_LIFE_PRESETS.map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => setStartingLife(value)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition",
                value === session.startingLife
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-accent",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setCommanderRules(!session.commanderRules);
          }}
          className={cn(session.commanderRules && "bg-accent")}
        >
          <GameIcon icon="crown" className="mr-2 size-4" /> Commander rules
          {session.commanderRules && <span className="ml-auto text-xs">on</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Timer mode</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setTimerMode("shared");
          }}
          className={cn(session.timerMode === "shared" && "bg-accent")}
        >
          Shared game clock
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setTimerMode("chess");
          }}
          className={cn(session.timerMode === "chess" && "bg-accent")}
        >
          Per-player chess clock
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Game title</DropdownMenuLabel>
        <div className="px-2 pb-2">
          <Input
            key={session.id}
            defaultValue={session.tag ?? ""}
            onBlur={(e) => setSessionTag(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="Untitled game"
            className="h-8 text-xs"
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenLog}>
          <ListOrdered className="mr-2 size-4" /> Game log
          <span className="ml-auto tabular-nums text-xs text-muted-foreground">
            {session.history.length}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Reset</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => resetCounters("life")}>
          <RotateCcw className="mr-2 size-4" /> Life only
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => resetCounters("counters")}>
          <RotateCcw className="mr-2 size-4" /> Counters only
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => resetCounters("commander-damage")}>
          <RotateCcw className="mr-2 size-4" /> Commander damage
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => resetGame()}>
          <RotateCcw className="mr-2 size-4" /> Reset everything
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
  );
}
