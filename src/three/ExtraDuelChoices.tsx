import { ChoicePages } from "@/three/ChoicePages";
import { useState } from "react";
import type { PromptInput, PromptOutput } from "@manabrew/protocol";
import { ManaSymbol } from "@/three/ManaSymbols";
import { ManaText } from "@/three/ManaSymbols";

export function ExtraDuelChoices({
  input,
  send,
}: {
  input: PromptInput;
  send: (output: PromptOutput) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  switch (input.type) {
    case "diceRolled":
      return (
        <ChoicePages>
          <div className="duel-dice-results">
            {input.rolls.map((roll, i) => (
              <div key={i} data-highlighted={roll.highlighted}>
                <small>{roll.label ?? (roll.playerId === "player-0" ? "You" : "Opponent")}</small>
                <strong>{roll.finalResults.join(" + ")}</strong>
                <small>d{input.sides}</small>
              </div>
            ))}
          </div>
          <button
            className="duel-primary"
            onClick={() => send({ type: input.type, output: { type: "diceRolledAcknowledged" } })}
          >
            Continue
          </button>
        </ChoicePages>
      );
    case "chooseFromSelection": {
      const total = chosen.reduce((sum, i) => sum + input.options[i].weight, 0);
      return (
        <ChoicePages>
          <p>
            Choose{" "}
            {input.minTotal === input.maxTotal
              ? input.minTotal
              : `${input.minTotal}–${input.maxTotal}`}
            . Selected: {total}
          </p>
          {input.options.map((option, i) => (
            <button
              key={i}
              data-selected={chosen.includes(i)}
              disabled={
                total + option.weight > input.maxTotal && (option.canRepeat || !chosen.includes(i))
              }
              onClick={() =>
                setChosen((old) =>
                  !option.canRepeat && old.includes(i) ? old.filter((n) => n !== i) : [...old, i],
                )
              }
            >
              <ManaText text={option.label} />
              {chosen.includes(i) ? ` ×${chosen.filter((n) => n === i).length}` : ""}
            </button>
          ))}
          {chosen.length > 0 && <button onClick={() => setChosen([])}>Clear selection</button>}
          <button
            disabled={total < input.minTotal || total > input.maxTotal}
            onClick={() =>
              send({
                type: input.type,
                output: { type: "selectionDecision", chosenIndices: chosen },
              })
            }
          >
            Confirm choice
          </button>
        </ChoicePages>
      );
    }
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
                <ManaSymbol symbol={color} /> {color}
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
    case "scry": {
      const entries =
        input.type === "reorder"
          ? input.items.map((item) => ({ id: item.id, name: item.card.identity.name }))
          : input.cards.map((card) => ({ id: card.id, name: card.identity.name }));
      const ids = order.length ? order : entries.map((c) => c.id);
      return (
        <ChoicePages>
          <p>Arrange cards from first to last.</p>
          {ids.map((id, i) => (
            <div className="duel-order-row" key={id}>
              <span>
                {i + 1}. {entries.find((c) => c.id === id)?.name}
              </span>
              {input.type === "scry" && (
                <select
                  aria-label={`Destination for ${entries.find((c) => c.id === id)?.name}`}
                  value={counts[id] ?? 0}
                  onChange={(e) => setCounts({ ...counts, [id]: Number(e.target.value) })}
                >
                  {input.zones.map((zone, n) => (
                    <option key={zone} value={n}>
                      {zone.replace(/([A-Z])/g, " $1")}
                    </option>
                  ))}
                </select>
              )}
              <button
                aria-label={`Move ${entries.find((c) => c.id === id)?.name} earlier`}
                disabled={i === 0}
                onClick={() => {
                  const next = [...ids];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  setOrder(next);
                }}
              >
                ↑
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              input.type === "reorder"
                ? send({ type: input.type, output: { type: "reorderDecision", orderedIds: ids } })
                : send({
                    type: input.type,
                    output: {
                      type: "scryDecision",
                      zoneCardIds: input.zones.map((_, i) =>
                        ids.filter((id) => (counts[id] ?? 0) === i),
                      ),
                    },
                  })
            }
          >
            Confirm arrangement
          </button>
        </ChoicePages>
      );
    }
    default:
      return null;
  }
}
