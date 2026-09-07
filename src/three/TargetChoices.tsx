import { useState } from "react";
import type { ChooseBoardTargetsInput, PromptOutput } from "@manabrew/protocol";
import { GameIcon } from "@/three/GameIcon";
import "@/three/TargetChoices.css";

export function TargetChoices({
  input,
  selected,
  onSelected,
  name,
  send,
}: {
  input: ChooseBoardTargetsInput;
  selected: string[];
  onSelected: (ids: string[]) => void;
  name: (id: string) => string;
  send: (output: PromptOutput) => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(input.candidates.length / 3));
  const current = Math.min(page, pages - 1);
  const ready = selected.length >= input.minTargets && selected.length <= input.maxTargets;
  return (
    <section
      className="arena-actions duel-prompt duel-target-choices"
      data-choice="chooseBoardTargets"
    >
      <strong>{input.presentation.title}</strong>
      <div className="target-selection-status" role="status">
        <span>
          {selected.length} / {input.maxTargets} selected
        </span>
        <span>
          {ready
            ? "Ready to confirm"
            : `Choose ${Math.max(0, input.minTargets - selected.length)} more`}
        </span>
      </div>
      <p className="target-selection-hint">Click a glowing target or drag from the spell.</p>
      <div className="duel-prompt-options target-choice-list">
        {input.candidates.slice(current * 3, current * 3 + 3).map((target) => (
          <button
            key={`${target.kind}:${target.id}`}
            data-target-id={target.id}
            data-selected={selected.includes(target.id)}
            aria-pressed={selected.includes(target.id)}
            onClick={() =>
              onSelected(
                selected.includes(target.id)
                  ? selected.filter((id) => id !== target.id)
                  : [...selected, target.id],
              )
            }
          >
            <span>
              {target.kind === "player"
                ? target.id === "player-0"
                  ? "You"
                  : "Opponent"
                : name(target.id)}
            </span>
            {selected.includes(target.id) && <GameIcon name="confirm" />}
          </button>
        ))}
      </div>
      {pages > 1 && (
        <nav className="duel-choice-pages" aria-label="Target choices">
          <button
            aria-label="Previous targets"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ‹
          </button>
          <span>
            Targets {current * 3 + 1}–{Math.min((current + 1) * 3, input.candidates.length)} of{" "}
            {input.candidates.length}
          </span>
          <button
            aria-label="Next targets"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            ›
          </button>
        </nav>
      )}
      <div className="duel-prompt-confirmation target-choice-actions">
        <button
          className="target-confirm"
          disabled={!ready}
          onClick={() =>
            send({
              type: "chooseBoardTargets",
              output: {
                type: "boardTargets",
                chosen: input.candidates.filter((target) => selected.includes(target.id)),
              },
            })
          }
        >
          <GameIcon name="confirm" />
          {selected.length
            ? `Confirm ${selected.length} target${selected.length === 1 ? "" : "s"}`
            : input.minTargets === 0
              ? "Confirm no targets"
              : "Confirm targets"}
        </button>
        {input.cancellable && (
          <button onClick={() => send({ type: "chooseBoardTargets", output: { type: "cancel" } })}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
