import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type DevCardRailMode, useGameDevStore } from "@/stores/useGameDevStore";

const MODE_LABELS: Record<DevCardRailMode, string> = {
  page: "Page",
  saga: "Saga",
  class: "Class",
};

const CURRENT_MAX_PRESETS: Array<{ current: number; final: number }> = [
  { current: 1, final: 1 },
  { current: 1, final: 2 },
  { current: 2, final: 2 },
  { current: 1, final: 3 },
  { current: 2, final: 3 },
  { current: 3, final: 3 },
  { current: 1, final: 4 },
  { current: 4, final: 4 },
];

const CLASS_PRESETS: Array<{ current: number; final: number }> = [
  { current: 1, final: 3 },
  { current: 2, final: 3 },
  { current: 3, final: 3 },
];

const REPLAY_STEP_MS = 180;

export function CardRailDevControls() {
  const mode = useGameDevStore((s) => s.debugCardMode);
  const current = useGameDevStore((s) => s.debugCardCurrent);
  const final = useGameDevStore((s) => s.debugCardFinal);
  const setMode = useGameDevStore((s) => s.setDebugCardMode);
  const setRail = useGameDevStore((s) => s.setDebugCardRail);
  const setCurrent = useGameDevStore((s) => s.setDebugCardCurrent);
  const reset = useGameDevStore((s) => s.resetDebugCardRail);

  const [isReplaying, setIsReplaying] = useState(false);
  const timerRef = useRef<number | null>(null);
  const replayTokenRef = useRef(0);

  const cancelReplayTimers = useCallback(() => {
    replayTokenRef.current += 1;
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopReplay = useCallback(() => {
    cancelReplayTimers();
    setIsReplaying(false);
  }, [cancelReplayTimers]);

  function stepReplay(token: number): void {
    const state = useGameDevStore.getState();
    if (replayTokenRef.current !== token) return;
    if (state.debugCardCurrent >= state.debugCardFinal) {
      timerRef.current = null;
      setIsReplaying(false);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      if (replayTokenRef.current !== token) return;
      const nextState = useGameDevStore.getState();
      if (nextState.debugCardCurrent >= nextState.debugCardFinal) {
        timerRef.current = null;
        setIsReplaying(false);
        return;
      }
      nextState.setDebugCardCurrent(nextState.debugCardCurrent + 1);
      stepReplay(token);
    }, REPLAY_STEP_MS);
  }

  const startReplay = () => {
    stopReplay();
    const token = replayTokenRef.current;
    setCurrent(1);
    setIsReplaying(true);
    stepReplay(token);
  };

  useEffect(() => () => stopReplay(), [stopReplay]);
  useEffect(() => {
    if (mode === "class" && (current < 1 || current > 3 || final !== 3)) {
      setRail(Math.max(1, Math.min(3, current)), 3);
    }
  }, [current, final, mode, setRail]);

  const dirty = isReplaying || mode !== "page" || current !== 1 || final !== 3;
  const presets = mode === "class" ? CLASS_PRESETS : CURRENT_MAX_PRESETS;
  const minimumCurrent = mode === "class" ? 1 : 0;
  const maximumCurrent = mode === "class" ? 3 : final;

  return (
    <div className="flex flex-col gap-2 mt-2 rounded-md border border-border/70 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Saga / Class / Page
        </span>
        {dirty && (
          <button
            className="text-[10px] uppercase text-muted-foreground hover:text-destructive"
            onClick={() => {
              stopReplay();
              reset();
            }}
          >
            Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {(Object.keys(MODE_LABELS) as DevCardRailMode[]).map((railMode) => (
          <button
            key={railMode}
            type="button"
            className={cn(
              "px-2 py-1.5 rounded text-xs font-medium border transition-colors",
              mode === railMode
                ? "border-primary text-primary bg-primary/10"
                : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
            onClick={() => {
              stopReplay();
              if (railMode === "class") {
                setRail(Math.max(1, Math.min(3, current)), 3);
              }
              setMode(railMode);
            }}
          >
            {MODE_LABELS[railMode]}
          </button>
        ))}
      </div>

      <div className={cn("grid gap-1.5", mode === "class" ? "grid-cols-3" : "grid-cols-4")}>
        {presets.map((preset) => {
          const active = current === preset.current && final === preset.final;
          return (
            <button
              key={`${preset.current}/${preset.final}`}
              type="button"
              className={cn(
                "px-2 py-1.5 rounded text-xs font-medium border transition-colors",
                active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
              onClick={() => {
                stopReplay();
                setRail(preset.current, preset.final);
              }}
            >
              {preset.current}/{preset.final}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          className="px-2 py-1.5 rounded text-xs font-medium border border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={current <= minimumCurrent}
          onClick={() => {
            stopReplay();
            setCurrent(current - 1);
          }}
        >
          Previous
        </button>
        <button
          type="button"
          className="px-2 py-1.5 rounded text-xs font-medium border border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={current >= maximumCurrent}
          onClick={() => {
            stopReplay();
            setCurrent(current + 1);
          }}
        >
          Next
        </button>
        <button
          type="button"
          className={cn(
            "px-2 py-1.5 rounded text-xs font-medium border transition-colors",
            isReplaying
              ? "border-primary text-primary bg-primary/10"
              : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50",
          )}
          onClick={startReplay}
        >
          Replay
        </button>
        <div className="flex items-center justify-center rounded border border-border/70 text-[10px] uppercase tracking-wide text-muted-foreground">
          {current}/{final}
        </div>
      </div>
    </div>
  );
}
