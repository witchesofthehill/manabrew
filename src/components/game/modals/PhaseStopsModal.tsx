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
  activePlayerId: string;
  myPlayerId: string;
  selfColor: string;
  selfStops: ReadonlySet<string>;
  opponents: OpponentStops[];
  onToggleSelf: (phase: string) => void;
  onToggleOpponent: (opponentId: string, phase: string) => void;
  onClose: () => void;
}

export function PhaseStopsModal({
  currentStep,
  activePlayerId,
  myPlayerId,
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
  const seats = [
    {
      id: myPlayerId,
      title: "Your turn",
      color: selfColor,
      stops: selfStops,
      onToggle: onToggleSelf,
    },
    ...opponents.map((opponent) => ({
      id: opponent.id,
      title: `${opponent.name}'s turn`,
      color: opponent.color,
      stops: opponent.stops,
      onToggle: (step: string) => onToggleOpponent(opponent.id, step),
    })),
  ];

  return (
    <Modal maxWidth="max-w-4xl" onClose={onClose}>
      <Modal.Header>
        <h2 className="text-base font-semibold">Phase stops</h2>
      </Modal.Header>
      <Modal.Instructions>
        Passing priority skips ahead to your next stop. A filled phase is a stop.
      </Modal.Instructions>
      <Modal.Body className="space-y-4 overflow-x-auto">
        {seats.map((seat) => {
          const seatInk = readableTextColor(
            seat.color,
            gameTheme.canvas.shadow,
            gameTheme.textOnTinted,
          );
          const active = seat.id === activePlayerId;
          return (
            <section key={seat.id} className="min-w-[36rem] space-y-1.5">
              <h3 className="flex items-center gap-2 text-ui-label font-semibold text-foreground">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: seat.color }} />
                {seat.title}
                {active && (
                  <span className="text-ui-caption font-bold uppercase tracking-wide text-muted-foreground">
                    Now
                  </span>
                )}
              </h3>
              <div className="grid grid-cols-[1fr_1fr_1fr_1.6fr_1fr_1fr_1fr] gap-1.5">
                {PHASE_BAR_ENTRIES.map((entry) => {
                  const enabled = entry.steps.some((step) => seat.stops.has(step));
                  return (
                    <div key={entry.id} className="space-y-1">
                      <button
                        type="button"
                        aria-label={`${entry.label} stop, ${seat.title}`}
                        aria-pressed={enabled}
                        title={PHASE_DETAILS[entry.id]}
                        className="flex h-12 w-full items-center justify-center rounded-md border-2 px-1 font-game text-ui-label font-bold motion-safe:transition-[scale] active:scale-95"
                        style={{
                          borderColor: seat.color,
                          backgroundColor: enabled ? seat.color : surface,
                          color: enabled ? seatInk : surfaceInk,
                        }}
                        onClick={() => togglePhaseStops(entry.steps, seat.stops, seat.onToggle)}
                      >
                        {entry.label}
                      </button>
                      <div className="h-1">
                        {active && entry.steps.includes(currentStep) && (
                          <div
                            className="h-full rounded-full"
                            style={{ backgroundColor: seat.color }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close onClose={onClose} variant="ghost">
          Done
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}
