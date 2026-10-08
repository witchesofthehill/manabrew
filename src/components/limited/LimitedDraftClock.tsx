import { Pause, Play, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDraftClock } from "@/components/limited/useDraftClock";
import { pauseDraftClock } from "@/game/limitedDraftClock";
import { cn } from "@/lib/utils";

interface LimitedDraftClockProps {
  sessionId: string;
  seat?: number;
  canControl?: boolean;
}

export function LimitedDraftClock({
  sessionId,
  seat = 0,
  canControl = false,
}: LimitedDraftClockProps) {
  const { clock, seat: activeSeat, remainingSeconds } = useDraftClock(sessionId, seat);
  if (!clock) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <span
        role="timer"
        aria-label={
          clock.paused
            ? "Pick clock paused"
            : activeSeat
              ? `${remainingSeconds} seconds remaining`
              : "Waiting for a pack"
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium tabular-nums",
          activeSeat && !clock.paused && remainingSeconds <= 10
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        <Timer className="h-3.5 w-3.5" />
        {clock.paused
          ? "Paused"
          : activeSeat
            ? `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`
            : "Waiting"}
      </span>
      {canControl && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs"
          onClick={() => {
            void pauseDraftClock(sessionId, !clock.paused).catch((error: unknown) =>
              toast.error(
                error instanceof Error ? error.message : "The clock could not be changed.",
              ),
            );
          }}
        >
          {clock.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          <span>{clock.paused ? "Resume" : "Pause"}</span>
        </Button>
      )}
    </div>
  );
}
