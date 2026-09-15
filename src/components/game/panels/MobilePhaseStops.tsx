import type { CSSProperties } from "react";

import { PHASES } from "@/components/game/game.constants";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import type { StepKind } from "@/protocol";

const COMBAT_STOP: StepKind = "combatDeclareAttackers";
const COMBAT_PHASE_IDS = PHASES.filter((phase) => phase.combat).map((phase) => phase.id);
export const PHASE_CONTROLS = PHASES.filter(
  (phase) => phase.id !== "untap" && (!phase.combat || phase.id === COMBAT_STOP),
).map((phase) => ({
  id: phase.id,
  label: phase.combat ? "Combat" : phase.label,
  short: phase.combat ? "COM" : phase.short,
  currentSteps: phase.combat ? COMBAT_PHASE_IDS : [phase.id],
}));

interface OpponentStops {
  id: string;
  name: string;
  color: string;
  stops: ReadonlySet<string>;
}

interface MobilePhaseStopsProps {
  open: boolean;
  currentStep: StepKind;
  activeColor: string;
  selfColor: string;
  selfStops: ReadonlySet<string>;
  opponents: OpponentStops[];
  onClose: () => void;
  onToggleSelf: (phase: string) => void;
  onToggleOpponent: (opponentId: string, phase: string) => void;
}

export function MobilePhaseStops({
  open,
  currentStep,
  selfStops,
  activeColor,
  selfColor,
  opponents,
  onClose,
  onToggleSelf,
  onToggleOpponent,
}: MobilePhaseStopsProps) {
  const { appTheme, gameTheme } = useTheme();
  if (!open) return null;

  const currentPhase = PHASES.find((phase) => phase.id === currentStep);
  const currentLabel = currentPhase?.label ?? currentStep;
  const currentShort = currentPhase?.combat ? "COM" : (currentPhase?.short ?? currentStep);

  return (
    <div className="pointer-events-auto absolute inset-0 z-[3]">
      <button
        type="button"
        className="absolute inset-0 bg-background/70 backdrop-blur-[2px]"
        aria-label="Close phase stops"
        onClick={onClose}
      />
      <section
        aria-label="Phase stops"
        className="absolute inset-x-2 bottom-2 max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border border-border/80 bg-card/95 p-3 shadow-2xl backdrop-blur-md"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="shrink-0 rounded-full border-2 px-3 py-1 font-game text-xs font-bold text-foreground"
              style={{
                backgroundColor: gameTheme.phaseStrip.background,
                borderColor: activeColor,
              }}
            >
              {currentShort}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Phase stops
              </p>
              <h2 className="truncate font-game text-sm font-semibold text-foreground">
                {currentLabel}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="min-h-12 rounded-lg border border-border bg-background/60 px-4 text-sm font-semibold text-foreground motion-safe:transition-[scale,background-color,border-color] active:scale-[0.98]"
            onClick={onClose}
          >
            Done
          </button>
        </div>

        <div className="space-y-2">
          <StopRow
            label="You"
            stops={selfStops}
            currentStep={currentStep}
            seatColor={selfColor}
            activeColor={activeColor}
            phaseSurface={gameTheme.phaseStrip.background}
            inactiveBorder={appTheme.border}
            onToggle={onToggleSelf}
          />
          {opponents.map((opponent) => (
            <StopRow
              key={opponent.id}
              label={opponent.name}
              stops={opponent.stops}
              currentStep={currentStep}
              seatColor={opponent.color}
              activeColor={activeColor}
              phaseSurface={gameTheme.phaseStrip.background}
              inactiveBorder={appTheme.border}
              onToggle={(phase) => onToggleOpponent(opponent.id, phase)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function StopRow({
  label,
  stops,
  currentStep,
  seatColor,
  activeColor,
  phaseSurface,
  inactiveBorder,
  onToggle,
}: {
  label: string;
  stops: ReadonlySet<string>;
  currentStep: StepKind;
  seatColor: string;
  activeColor: string;
  phaseSurface: string;
  inactiveBorder: string;
  onToggle: (phase: string) => void;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] gap-1">
      <div className="flex min-w-0 items-center pr-1">
        <span className="truncate text-xs font-semibold text-muted-foreground">{label}</span>
      </div>
      {PHASE_CONTROLS.map((phase) => {
        const enabled = stops.has(phase.id);
        const current = phase.currentSteps.includes(currentStep);
        const style: CSSProperties = {
          backgroundColor: phaseSurface,
          borderColor: current ? activeColor : inactiveBorder,
          boxShadow: current ? `inset 0 0 0 1px ${activeColor}` : undefined,
        };
        return (
          <button
            key={phase.id}
            type="button"
            aria-label={`${label}: ${phase.label} stop`}
            aria-pressed={enabled}
            title={phase.label}
            className={cn(
              "relative flex min-h-12 min-w-0 items-center justify-center rounded-md border px-1 pb-1 font-game text-[10px] font-bold motion-safe:transition-[scale,background-color,border-color] active:scale-95",
              current || enabled ? "text-foreground" : "text-muted-foreground",
            )}
            style={style}
            onClick={() => onToggle(phase.id)}
          >
            {phase.short}
            <span
              className="absolute inset-x-2 bottom-1 h-1 rounded-full"
              style={{
                backgroundColor: enabled ? seatColor : inactiveBorder,
                opacity: enabled ? 1 : 0.25,
              }}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}
