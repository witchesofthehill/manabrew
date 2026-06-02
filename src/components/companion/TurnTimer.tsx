import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { GameIcon } from "./GameIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";

export function TurnTimer({ className }: { className?: string }) {
  const timer = useCompanionStore((s) => s.session?.timer);
  const startTimer = useCompanionStore((s) => s.startTimer);
  const pauseTimer = useCompanionStore((s) => s.pauseTimer);
  const resetTimer = useCompanionStore((s) => s.resetTimer);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!timer?.startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [timer?.startedAt]);

  if (!timer) return null;

  const running = Boolean(timer.startedAt);
  const elapsedMs = timer.accumulatedMs + (timer.startedAt ? now - timer.startedAt : 0);

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md bg-muted/60 px-1.5 py-0.5 sm:gap-1 sm:px-2 sm:py-1",
        className,
      )}
    >
      <GameIcon icon="sands-of-time" className="size-3.5 text-muted-foreground" />
      <span className="min-w-[44px] text-center tabular-nums text-xs font-medium sm:min-w-[60px] sm:text-sm">
        {formatElapsed(elapsedMs)}
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
