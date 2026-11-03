import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import type { OpponentStops } from "@/components/game/panels/MobilePhaseStops";
import { useTheme } from "@/hooks/useTheme";
import type { StepKind } from "@/protocol";
import { readableTextColor } from "@/themes/gameTheme";
import { Modal } from "./Modal";

const PHASE_DETAILS: Record<string, string> = {
  upkeep: "Upkeep triggers resolve. Last chance to act before the draw.",
  draw: "The active player draws for the turn.",
  main1: "Cast creatures, sorceries and other permanents, and play a land.",
  combat:
    "Attackers and blockers are declared and combat damage is dealt. A stop here pauses at every combat step.",
  main2: "Cast permanents and sorceries, and play a land if you haven't yet.",
  endOfTurn: "End step triggers. The usual time for instant-speed plays.",
  cleanup: "Discard to hand size and remove damage. Normally no priority here.",
};

interface PhaseStopsModalProps {
  currentStep: StepKind;
  activeColor: string;
  selfColor: string;
  selfStops: ReadonlySet<string>;
  opponents: OpponentStops[];
  onToggleSelf: (phase: string) => void;
  onToggleOpponent: (opponentId: string, phase: string) => void;
  onClose: () => void;
}

export function PhaseStopsModal({
  currentStep,
  activeColor,
  selfColor,
  selfStops,
  opponents,
  onToggleSelf,
  onToggleOpponent,
  onClose,
}: PhaseStopsModalProps) {
  const { gameTheme } = useTheme();
  const surface = gameTheme.phaseStrip.background;
  const surfaceInk = readableTextColor(surface, gameTheme.canvas.shadow, gameTheme.textOnTinted);
  const activeInk = readableTextColor(activeColor, gameTheme.canvas.shadow, gameTheme.textOnTinted);

  return (
    <Modal maxWidth="max-w-xl" onClose={onClose}>
      <Modal.Header>
        <h2 className="text-base font-semibold">Phase stops</h2>
      </Modal.Header>
      <Modal.Instructions>Passing priority skips ahead to your next stop.</Modal.Instructions>
      <Modal.Body className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-background px-3 py-2.5 text-ui-meta font-semibold text-foreground">
          <div className="flex items-stretch gap-1.5">
            <span className="w-2 rounded-sm" style={{ backgroundColor: selfColor }} />
            <span
              className="flex h-11 items-center rounded-md px-2.5 font-game text-ui-label font-bold"
              style={{ backgroundColor: surface, color: surfaceInk }}
            >
              M1
            </span>
            <span className="flex w-2 flex-col gap-[3px]">
              {opponents.map((opponent) => (
                <span
                  key={opponent.id}
                  className="flex-1 rounded-sm"
                  style={{ backgroundColor: opponent.color }}
                />
              ))}
            </span>
          </div>
          <div className="space-y-1">
            <LegendRow color={selfColor} label="You" detail="your turns" />
            {opponents.map((opponent) => (
              <LegendRow
                key={opponent.id}
                color={opponent.color}
                label={opponent.name}
                detail="their turn"
              />
            ))}
          </div>
          <div className="space-y-1.5">
            <span className="flex items-center gap-2">
              <span
                className="h-4 w-2 rounded-sm border-2"
                style={{ borderColor: selfColor, backgroundColor: selfColor }}
              />
              Stop
            </span>
            <span className="flex items-center gap-2">
              <span
                className="h-4 w-2 rounded-sm border-2"
                style={{ borderColor: selfColor, backgroundColor: gameTheme.canvas.shadow }}
              />
              Skip
            </span>
          </div>
        </div>
        <div
          className="space-y-1.5 rounded-xl border-2 bg-card p-2"
          style={{ borderColor: activeColor }}
        >
          {PHASE_BAR_ENTRIES.map((entry) => {
            const current = entry.steps.includes(currentStep);
            return (
              <div key={entry.id} className="grid grid-cols-[1.75rem_1fr_1.75rem] gap-2">
                <StopBar
                  label={`You: ${entry.label} stop`}
                  color={selfColor}
                  dark={gameTheme.canvas.shadow}
                  enabled={entry.steps.some((step) => selfStops.has(step))}
                  onToggle={() => togglePhaseStops(entry.steps, selfStops, onToggleSelf)}
                />
                <div
                  className="rounded-md px-3 py-2"
                  style={{
                    backgroundColor: current ? activeColor : surface,
                    color: current ? activeInk : surfaceInk,
                  }}
                >
                  <p className="flex items-baseline gap-2">
                    <span className="font-game text-ui-label font-bold">{entry.short}</span>
                    <span className="text-ui-meta font-semibold">{entry.label}</span>
                    {current && (
                      <span className="text-ui-caption font-bold uppercase tracking-wide">Now</span>
                    )}
                  </p>
                  <p className="text-ui-meta">{PHASE_DETAILS[entry.id]}</p>
                </div>
                <div className="flex flex-col gap-[3px]">
                  {opponents.map((opponent) => (
                    <StopBar
                      key={opponent.id}
                      label={`${opponent.name}: ${entry.label} stop`}
                      color={opponent.color}
                      dark={gameTheme.canvas.shadow}
                      enabled={entry.steps.some((step) => opponent.stops.has(step))}
                      onToggle={() =>
                        togglePhaseStops(entry.steps, opponent.stops, (step) =>
                          onToggleOpponent(opponent.id, step),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close onClose={onClose} variant="ghost">
          Done
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}

function LegendRow({ color, label, detail }: { color: string; label: string; detail: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
      <span className="font-normal text-muted-foreground">· {detail}</span>
    </span>
  );
}

function StopBar({
  label,
  color,
  dark,
  enabled,
  onToggle,
}: {
  label: string;
  color: string;
  dark: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      className="min-h-6 w-full flex-1 rounded-sm border-2 motion-safe:transition-[scale] active:scale-95"
      style={{ borderColor: color, backgroundColor: enabled ? color : dark }}
      onClick={onToggle}
    />
  );
}
