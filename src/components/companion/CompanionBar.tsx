import { useRef, useState } from "react";
import {
  ChevronRight,
  Maximize2,
  Minimize2,
  Moon,
  MoreHorizontal,
  Redo2,
  Sun,
  SunMoon,
  Undo2,
} from "lucide-react";
import { LayoutIcon } from "./LayoutIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_ACCENT_COLORS,
  COMPANION_LAYOUT_LABELS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionSession } from "@/stores/useCompanionStore.types";
import { DiceMenu } from "./DiceMenu";
import { GameLog } from "./GameLog";
import { LayoutMenuItems } from "./LayoutMenuItems";
import { gridSeatOrder } from "./layouts/turnOrder";
import { SetupMenu } from "./SetupMenu";
import { StartGameDialog } from "./StartGameDialog";
import { TurnTimer } from "./TurnTimer";
interface CompanionBarProps {
  session: CompanionSession;
  getClockwiseSeats: () => string[];
  onOpenNewSession: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}
export function CompanionBar({
  session,
  getClockwiseSeats,
  onOpenNewSession,
  fullscreen,
  onToggleFullscreen,
}: CompanionBarProps) {
  const undo = useCompanionStore((s) => s.undo);
  const redo = useCompanionStore((s) => s.redo);
  const canRedo = useCompanionStore((s) => (s.session?.redoStack.length ?? 0) > 0);
  const advanceTurn = useCompanionStore((s) => s.advanceTurn);
  const setFirstPlayer = useCompanionStore((s) => s.setFirstPlayer);
  const cycleDayNight = useCompanionStore((s) => s.cycleDayNight);
  const activePlayer = session.players.find((p) => p.id === session.activePlayerId) ?? null;
  const started = session.turn > 0;
  const hasLivingPlayer = session.players.some((player) => !player.isDead);
  const turnTrigger = useRef<HTMLButtonElement>(null);
  const [clockwiseSeats, setClockwiseSeats] = useState<string[] | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const DayNightIcon =
    session.dayNight === "night" ? Moon : session.dayNight === "day" ? Sun : SunMoon;
  const layoutLabel = COMPANION_LAYOUT_LABELS[session.layout];
  const turnAction = started ? "Next turn" : "Start game";
  const turnLabel = activePlayer
    ? `${turnAction}, turn ${session.turn}: ${activePlayer.name}`
    : turnAction;
  const dayNight =
    session.dayNight === "night" ? "Night" : session.dayNight === "day" ? "Day" : "Off";
  return (
    <div
      role="group"
      aria-label="Table tools"
      className="flex min-h-14 min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain bg-card px-1.5 py-1 sm:gap-2 sm:px-3"
    >
      <SetupMenu
        session={session}
        onOpenNewSession={onOpenNewSession}
        onOpenLog={() => setLogOpen(true)}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="hidden h-9 shrink-0 gap-1.5 @min-[46rem]/companion-tracker:inline-flex touch:min-h-11"
            aria-label={`Layout: ${layoutLabel}`}
            title={`Layout: ${layoutLabel}`}
          >
            <LayoutIcon layout={session.layout} className="size-4" />
            Layout
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <LayoutMenuItems session={session} />
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {activePlayer && (
          <span
            className="hidden max-w-40 items-center gap-1.5 text-ui-meta font-semibold @min-[42rem]/companion-tracker:flex"
            title={`Turn ${session.turn}: ${activePlayer.name}`}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: COMPANION_ACCENT_COLORS[activePlayer.accentKey] }}
            />
            <span className="shrink-0 tabular-nums">T{session.turn}</span>
            <span className="truncate">{activePlayer.name}</span>
          </span>
        )}
        <TurnTimer />
        <DiceMenu players={session.players} />
        <Button
          size="icon"
          variant="ghost"
          className="size-9 touch:min-h-11 touch:min-w-11"
          onClick={undo}
          aria-label="Undo last action"
          title="Undo last action"
        >
          <Undo2 />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-9 touch:min-h-11 touch:min-w-11"
              aria-label="More table tools"
              title="More table tools"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={redo} disabled={!canRedo}>
              <Redo2 /> Redo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={cycleDayNight}>
              <DayNightIcon /> Day/Night: {dayNight}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggleFullscreen}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
              {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          ref={turnTrigger}
          size="sm"
          variant="primary"
          className="h-9 shrink-0 gap-1.5 px-2 touch:min-h-11 touch:min-w-11"
          onClick={started ? advanceTurn : () => setClockwiseSeats(getClockwiseSeats())}
          disabled={!hasLivingPlayer}
          aria-haspopup={started ? undefined : "dialog"}
          aria-label={turnLabel}
          title={turnLabel}
        >
          <span className="hidden @min-[28rem]/companion-tracker:inline">{turnAction}</span>
          {activePlayer ? (
            <span className="tabular-nums @min-[42rem]/companion-tracker:hidden">
              T{session.turn}
            </span>
          ) : (
            <span className="@min-[28rem]/companion-tracker:hidden">
              {started ? "Next" : "Start"}
            </span>
          )}
          <ChevronRight />
        </Button>
      </div>
      <GameLog session={session} open={logOpen} onOpenChange={setLogOpen} />
      {clockwiseSeats && (
        <StartGameDialog
          key={session.id}
          players={session.players}
          clockwiseSeats={clockwiseSeats}
          arrangeGrid={session.layout !== "free"}
          onStart={(turnOrder, counterclockwise) => {
            const seatOrder =
              session.layout === "free"
                ? undefined
                : gridSeatOrder(
                    session.gridSeatOrder ?? session.players.map((player) => player.id),
                    clockwiseSeats,
                    turnOrder,
                    counterclockwise,
                  );
            setFirstPlayer(turnOrder[0]!, { turnOrder, seatOrder });
            setClockwiseSeats(null);
          }}
          onClose={() => setClockwiseSeats(null)}
          returnFocus={() => turnTrigger.current?.focus({ preventScroll: true })}
        />
      )}
    </div>
  );
}
