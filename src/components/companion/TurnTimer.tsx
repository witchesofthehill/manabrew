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
export function TurnTimer() {
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
  const isIdle = !running && shownMs === 0;
  const elapsed = formatElapsed(shownMs);
  const timerAction = running ? "Pause timer" : isIdle ? "Start timer" : "Resume timer";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 shrink-0 gap-1.5 px-2 touch:min-h-11 touch:min-w-11"
          aria-label={`Timer: ${elapsed}, ${session.timerMode === "chess" ? "chess clock" : "shared clock"}`}
          title={`Timer: ${elapsed}`}
        >
          <GameIcon icon="sands-of-time" className="size-4 text-muted-foreground" />
          <span className="hidden max-w-20 truncate tabular-nums @min-[22rem]/companion-tracker:inline">
            {elapsed}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="tabular-nums">Timer: {elapsed}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => (running ? pauseTimer() : startTimer())}>
          {running ? <Pause /> : <Play />} {timerAction}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={resetTimer}>
          <RotateCcw /> Reset timer
        </DropdownMenuItem>
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
  );
}
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
