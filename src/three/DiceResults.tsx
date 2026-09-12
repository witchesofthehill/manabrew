import type { PromptInput } from "@manabrew/protocol";
import "@/three/DiceResults.css";

export function DiceResults({
  input,
  onContinue,
}: {
  input: Extract<PromptInput, { type: "diceRolled" }>;
  onContinue: () => void;
}) {
  return (
    <div className="duel-roll-results">
      <small>
        {input.sourceCardName ?? "Battlefield roll"} · d{input.sides}
      </small>
      <div className="duel-roll-entries" aria-live="polite">
        {input.rolls.map((roll, i) => (
          <div className="duel-roll-entry" key={i} data-highlighted={roll.highlighted}>
            <span>{roll.label ?? (roll.playerId === "player-0" ? "You" : "Opponent")}</span>
            <strong>{roll.finalResults.join(" + ")}</strong>
            {roll.naturalResults.some((n, j) => n !== roll.finalResults[j]) && (
              <small>
                Rolled {roll.naturalResults.join(" + ")} · after modifiers:{" "}
                {roll.finalResults.join(" + ")}
              </small>
            )}
            {roll.ignoredRolls.length > 0 && <small>Ignored: {roll.ignoredRolls.join(", ")}</small>}
          </div>
        ))}
      </div>
      <button className="duel-primary" onClick={onContinue}>
        Continue
      </button>
    </div>
  );
}
