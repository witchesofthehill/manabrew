import { CardArrangement } from "@/three/CardArrangement";
import { DiceResults } from "@/three/DiceResults";
import { SelectionChoices } from "@/three/SelectionChoices";
import { ChoicePages } from "@/three/ChoicePages";
import { useState } from "react";
import type { PromptInput, PromptOutput } from "@manabrew/protocol";
import { ManaChoiceLabel } from "@/three/ManaSymbols";

export function ExtraDuelChoices({
  input,
  send,
}: {
  input: PromptInput;
  send: (output: PromptOutput) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  switch (input.type) {
    case "diceRolled":
      return (
        <DiceResults
          input={input}
          onContinue={() => send({ type: input.type, output: { type: "diceRolledAcknowledged" } })}
        />
      );
    case "chooseFromSelection":
      return <SelectionChoices input={input} send={send} />;
    case "chooseNumber": {
      const value = counts.number ?? input.min;
      return (
        <ChoicePages>
          <label>
            Choose a number ({input.min}–{input.max})
            <input
              type="number"
              min={input.min}
              max={input.max}
              value={value}
              onChange={(e) => setCounts({ number: Number(e.target.value) })}
            />
          </label>
          <button
            disabled={!Number.isInteger(value) || value < input.min || value > input.max}
            onClick={() =>
              send({ type: input.type, output: { type: "numberDecision", chosenNumber: value } })
            }
          >
            Confirm number
          </button>
        </ChoicePages>
      );
    }
    case "chooseColor": {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return (
        <ChoicePages>
          <p>
            Choose {input.amount} mana colors. Selected: {total}
          </p>
          {input.validColors.map((color) => (
            <label key={color}>
              <span>
                <ManaChoiceLabel label={color} />
              </span>
              <input
                aria-label={`${color} count`}
                type="number"
                min="0"
                max={input.repeatAllowed ? input.amount : 1}
                value={counts[color] ?? 0}
                onChange={(e) =>
                  setCounts({
                    ...counts,
                    [color]: Math.max(
                      0,
                      Math.min(input.repeatAllowed ? input.amount : 1, Number(e.target.value)),
                    ),
                  })
                }
              />
            </label>
          ))}
          <button
            disabled={total !== input.amount}
            onClick={() =>
              send({ type: input.type, output: { type: "colorDecision", chosenColors: counts } })
            }
          >
            Confirm colors
          </button>
        </ChoicePages>
      );
    }
    case "reorder":
    case "scry":
      return <CardArrangement input={input} send={send} />;
    default:
      return null;
  }
}
