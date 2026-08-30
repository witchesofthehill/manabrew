import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { type DevCardRailMode, useGameDevStore } from "@/stores/useGameDevStore";

import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION,
  DEV_SECTION_HEADING,
} from "./devPanel.styles";

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
  const enabled = useGameDevStore((s) => s.debugCardRailEnabled);
  const mode = useGameDevStore((s) => s.debugCardMode);
  const current = useGameDevStore((s) => s.debugCardCurrent);
  const final = useGameDevStore((s) => s.debugCardFinal);
  const setMode = useGameDevStore((s) => s.setDebugCardMode);
  const setEnabled = useGameDevStore((s) => s.setDebugCardRailEnabled);
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

  const dirty = isReplaying || enabled || mode !== "page" || current !== 1 || final !== 3;
  const presets = mode === "class" ? CLASS_PRESETS : CURRENT_MAX_PRESETS;
  const minimumCurrent = mode === "class" ? 1 : 0;
  const maximumCurrent = mode === "class" ? 3 : final;

  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={DEV_SECTION_HEADING}>Progress rails</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Check page, saga, and class milestones on the staged card.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty ? (
            <button
              type="button"
              className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-destructive"
              onClick={() => {
                stopReplay();
                reset();
              }}
            >
              Reset rail
            </button>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className="flex shrink-0 items-center gap-2 rounded-md text-[10px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              stopReplay();
              setEnabled(!enabled);
            }}
          >
            {enabled ? "Enabled" : "Disabled"}
            <span
              className={cn(
                "relative h-6 w-11 rounded-full border transition-colors",
                enabled ? "border-primary bg-primary" : "border-border/70 bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 block h-4.5 w-4.5 rounded-full bg-background shadow-sm transition-transform",
                  enabled ? "translate-x-[1.25rem]" : "translate-x-0.5",
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {enabled ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {(Object.keys(MODE_LABELS) as DevCardRailMode[]).map((railMode) => (
              <button
                key={railMode}
                type="button"
                className={cn(
                  DEV_CONTROL_BUTTON,
                  mode === railMode ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
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

          <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Milestone
          </p>
          <div className={cn("grid gap-1.5", mode === "class" ? "grid-cols-3" : "grid-cols-4")}>
            {presets.map((preset) => {
              const active = current === preset.current && final === preset.final;
              return (
                <button
                  key={`${preset.current}/${preset.final}`}
                  type="button"
                  className={cn(
                    DEV_CONTROL_BUTTON,
                    active ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
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

          <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
            <button
              type="button"
              className={cn(
                DEV_CONTROL_BUTTON,
                DEV_CONTROL_INACTIVE,
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
              )}
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
              className={cn(
                DEV_CONTROL_BUTTON,
                DEV_CONTROL_INACTIVE,
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
              )}
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
                DEV_CONTROL_BUTTON,
                isReplaying ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
              )}
              onClick={startReplay}
            >
              Replay
            </button>
            <div className="flex min-w-12 items-center justify-center rounded-md border border-border/70 bg-background/40 px-2 font-mono text-xs tabular-nums text-muted-foreground">
              {current}/{final}
            </div>
          </div>
        </>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
          Enable rails to add page, saga, or class progress to the staged card.
        </p>
      )}
    </section>
  );
}
