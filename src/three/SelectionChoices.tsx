import { useState } from "react";
import type { PromptInput, PromptOutput } from "@manabrew/protocol";
import { ManaChoiceLabel } from "@/three/ManaSymbols";
import { counterLabel } from "@/three/keywordDetails";
import "@/three/SelectionChoices.css";

type SelectionInput = Extract<PromptInput, { type: "chooseFromSelection" }>;
export function SelectionChoices({
  input,
  send,
}: {
  input: SelectionInput;
  send: (output: PromptOutput) => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const total = chosen.reduce((sum, i) => sum + input.options[i].weight, 0);
  const single =
    input.minTotal === 1 &&
    input.maxTotal === 1 &&
    input.options.every((o) => o.weight === 1 && !o.canRepeat);
  const ready = total >= input.minTotal && total <= input.maxTotal;
  const counterChoice =
    input.options.length > 0 &&
    input.options.every((option) => /^[PM]\d+[PM]\d+$/i.test(option.label.trim()));
  const labels = input.options.map((option) =>
    /^[PM]\d+[PM]\d+$/i.test(option.label.trim())
      ? `${counterLabel(option.label.trim())} counter`
      : option.label,
  );
  if (counterChoice && single && input.options.length === 1) {
    return (
      <div className="duel-selection">
        <p>Counter type</p>
        <button
          className="duel-primary"
          onClick={() =>
            send({ type: input.type, output: { type: "selectionDecision", chosenIndices: [0] } })
          }
        >
          Confirm {labels[0]}
        </button>
      </div>
    );
  }
  const colors =
    input.options.length <= 6 &&
    input.options.every((o) => /^(white|blue|black|red|green|colorless)$/i.test(o.label.trim()));
  const select = (index: number) =>
    setChosen((old) => {
      if (single) return old.includes(index) ? [] : [index];
      if (!input.options[index].canRepeat && old.includes(index))
        return old.filter((i) => i !== index);
      return [...old, index];
    });
  return (
    <div className="duel-selection">
      <div className="duel-selection-status" role="status">
        <strong>
          {single
            ? counterChoice
              ? "Choose a counter type"
              : "Choose one"
            : `Choose ${input.minTotal === input.maxTotal ? input.minTotal : `${input.minTotal}–${input.maxTotal}`}`}
        </strong>
        <span>
          {ready ? "Ready to confirm" : `${Math.max(0, input.minTotal - total)} more needed`}
        </span>
      </div>
      <div className="duel-selection-list" data-colors={colors}>
        {input.options.map((option, i) => {
          const count = chosen.filter((index) => index === i).length;
          const disabled =
            !single && total + option.weight > input.maxTotal && (option.canRepeat || !count);
          return (
            <div className="duel-selection-row" key={i}>
              <button aria-pressed={count > 0} disabled={disabled} onClick={() => select(i)}>
                <ManaChoiceLabel label={labels[i]} />
                {count > 0 && (
                  <span aria-hidden="true">{option.canRepeat ? `×${count}` : "✓"}</span>
                )}
              </button>
              {option.canRepeat && count > 0 && (
                <button
                  className="duel-selection-remove"
                  aria-label={`Remove one ${labels[i]}`}
                  onClick={() =>
                    setChosen((old) => {
                      const next = [...old];
                      next.splice(next.lastIndexOf(i), 1);
                      return next;
                    })
                  }
                >
                  −
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="duel-selection-summary">
        {chosen.length ? chosen.map((i) => labels[i]).join(" · ") : "Nothing selected"}
      </div>
      <footer className="duel-selection-footer">
        <button disabled={!chosen.length} onClick={() => setChosen([])}>
          Clear
        </button>
        <button
          className="duel-primary"
          disabled={!ready}
          onClick={() =>
            send({ type: input.type, output: { type: "selectionDecision", chosenIndices: chosen } })
          }
        >
          {single && chosen.length
            ? `Confirm ${labels[chosen[0]]}`
            : `Confirm ${chosen.length ? `${chosen.length} choice${chosen.length === 1 ? "" : "s"}` : ready ? "none" : "choice"}`}
        </button>
      </footer>
    </div>
  );
}
