import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
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
import { GameIcon } from "./GameIcon";

export function TurnTimer({ className }: { className?: string }) {
  const session = useCompanionStore((s) => s.session);
  const startTimer = useCompanionStore((s) => s.startTimer);
  const pauseTimer = useCompanionStore((s) => s.pauseTimer);
  const resetTimer = useCompanionStore((s) => s.resetTimer);
  const setTimerMode = useCompanionStore((s) => s.setTimerMode);
  const [now, setNow] = useState(0);

  const timer = session?.timer;
  const running = Boolean(timer?.startedAt);
  const chessActive =
    session?.timerMode === "chess" && session.chessClockStartedAt != null && session.activePlayerId;

  useEffect(() => {
    if (!running && !chessActive) return;
    const tick = () => setNow(Date.now());
    // Sample the clock once on the next microtask so the readout
    // doesn't render the stale `0` against a fresh startedAt before
    // the interval has fired for the first time.
    const initial = setTimeout(tick, 0);
    const interval = setInterval(tick, 500);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [running, chessActive]);

  if (!session) return null;

  // `now === 0` means the interval hasn't sampled the clock yet (initial
  // render or just-paused). Treat the live delta as zero so the readout
  // doesn't show -45 million minutes during the first frame after Play.
  const liveDelta = (startedAt: number) => (now > 0 ? Math.max(0, now - startedAt) : 0);
  const sharedElapsed =
    (timer?.accumulatedMs ?? 0) + (timer?.startedAt ? liveDelta(timer.startedAt) : 0);
  const activePlayer = session.players.find((p) => p.id === session.activePlayerId) ?? null;
  const chessElapsed =
    (activePlayer?.timeMs ?? 0) +
    (session.timerMode === "chess" && session.chessClockStartedAt != null && activePlayer
      ? liveDelta(session.chessClockStartedAt)
      : 0);

  const shownMs = session.timerMode === "chess" && activePlayer ? chessElapsed : sharedElapsed;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md bg-muted/60 px-1.5 py-0.5 sm:gap-1 sm:px-2 sm:py-1",
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label={`Timer mode: ${session.timerMode === "chess" ? "chess clock" : "shared"}`}
            title={session.timerMode === "chess" ? "Chess clock" : "Shared clock"}
          >
            <GameIcon icon="sands-of-time" className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Timer mode</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setTimerMode("shared")}
            className={cn(session.timerMode === "shared" && "bg-accent")}
          >
            Shared game clock
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setTimerMode("chess")}
            className={cn(session.timerMode === "chess" && "bg-accent")}
          >
            Per-player chess clock
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="min-w-[44px] text-center tabular-nums text-xs font-medium sm:min-w-[60px] sm:text-sm">
        {formatElapsed(shownMs)}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={() => (running ? pauseTimer() : startTimer())}
        aria-label={running ? "Pause timer" : "Start timer"}
      >
        {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={resetTimer}
        aria-label="Reset timer"
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
