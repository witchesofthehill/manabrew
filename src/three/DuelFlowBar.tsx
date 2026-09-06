import { LockKeyhole, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import beginning from "@/three/assets/phase-beginning.svg";
import main from "@/three/assets/phase-main.svg";
import combat from "@/three/assets/phase-combat.svg";
import end from "@/three/assets/phase-end.svg";
import preset from "@/themes/kanagawa";
import { duelPhases, stepNames } from "@/three/duelFlow";

const icons = { sun: beginning, card: main, swords: combat, moon: end };
const tints = {
  sun: preset.gameColors["phase.beginning"],
  card: preset.gameColors["phase.main"],
  swords: preset.gameColors["phase.combat"],
  moon: preset.gameColors["phase.end"],
};

export function DuelFlowBar({
  step,
  turn,
  ownTurn,
  fullControl,
  onControl,
  stops,
  onStop,
}: {
  step: string;
  turn: number;
  ownTurn: boolean;
  fullControl: boolean;
  onControl: () => void;
  stops: string[];
  onStop: (step: string) => void;
}) {
  return (
    <nav className="duel-flow" aria-label="Turn phases">
      <div className="duel-flow-heading">
        <span>
          {ownTurn ? "Your turn" : "Opponent’s turn"} · {turn}
        </span>
        <span aria-live="polite">{stepNames[step] ?? step}</span>
      </div>
      <div className="duel-flow-phases">
        {duelPhases.map((phase) => {
          const active = (phase.steps as readonly string[]).includes(step);
          const stopped = stops.includes(phase.id);
          return (
            <button
              key={phase.id}
              aria-label={`${phase.label} phase${phase.id === "main1" ? " 1" : phase.id === "main2" ? " 2" : ""}: ${stopped ? "remove" : "set"} stop`}
              aria-pressed={stopped}
              aria-current={active ? "step" : undefined}
              data-active={active}
              data-stop={stopped}
              style={{ "--phase-color": tints[phase.icon] } as CSSProperties}
              onClick={() => onStop(phase.id)}
              title="Pause at every priority window in this phase, on either player's turn"
            >
              <span className="duel-phase-emblem" aria-hidden="true">
                <span
                  className="duel-phase-glyph"
                  style={{ maskImage: `url("${icons[phase.icon]}")` }}
                />
                {phase.icon === "card" && <b>{phase.id === "main1" ? "I" : "II"}</b>}
              </span>
              <span>{phase.label}</span>
              <i />
            </button>
          );
        })}
      </div>
      <button
        className="duel-control"
        aria-pressed={fullControl}
        onClick={onControl}
        title="Toggle full control (Shift+Ctrl)"
      >
        {fullControl ? <LockKeyhole size={13} /> : <Zap size={13} />}{" "}
        {fullControl ? "Full control" : "Auto priority"}
        <kbd>⇧ Ctrl</kbd>
      </button>
      <small className="duel-flow-hint">
        {fullControl ? "Every priority window is yours" : "Space: next action / Click phase: stop"}
      </small>
    </nav>
  );
}
