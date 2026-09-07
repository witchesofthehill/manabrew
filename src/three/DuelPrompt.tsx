import { TargetChoices } from "@/three/TargetChoices";
import { NextAction } from "@/three/NextAction";
import type { AutoPassCountdown } from "@/three/arena.types";
import { GameIcon } from "@/three/GameIcon";
import { useState } from "react";
import { ManaText } from "@/three/ManaSymbols";
import { ChoicePages } from "@/three/ChoicePages";
import { ExtraDuelChoices } from "@/three/ExtraDuelChoices";
import type { CardDto, Prompt, PromptOutput } from "@manabrew/protocol";

export function DuelPrompt({
  prompt,
  cards,
  send,
  selected,
  onSelected,
  blocks,
  onBlocks,
  nextLabel = "Continue",
  autoPassing = false,
  autoPassCountdown,
  onHoldPriority,
  onAutoPay,
}: {
  prompt: Prompt;
  cards: CardDto[];
  send: (action: PromptOutput) => void;
  selected: string[];
  onSelected: (ids: string[]) => void;
  blocks: Record<string, string>;
  onBlocks: (blocks: Record<string, string>) => void;
  nextLabel?: string;
  autoPassing?: boolean;
  autoPassCountdown?: AutoPassCountdown | null;
  onHoldPriority?: () => void;
  onAutoPay?: () => void;
}) {
  const input = prompt.input;
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const name = (id: string) => cards.find((c) => c.id === id)?.identity.name ?? id;
  const toggle = (id: string) =>
    onSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  if (input.type === "chooseBoardTargets")
    return (
      <TargetChoices
        key={prompt.promptId}
        input={input}
        selected={selected}
        onSelected={onSelected}
        name={name}
        send={send}
      />
    );
  let controls;
  let confirmation;
  switch (input.type) {
    case "mulligan":
      controls = (
        <>
          <p>Inspect your opening hand.</p>
          <button
            onClick={() =>
              send({ type: input.type, output: { type: "mulliganDecision", keep: true } })
            }
          >
            <GameIcon name="hand" /> Keep hand
          </button>
          <button
            onClick={() =>
              send({ type: input.type, output: { type: "mulliganDecision", keep: false } })
            }
          >
            <GameIcon name="mulligan" /> Mulligan
          </button>
        </>
      );
      break;
    case "chooseAction":
      controls = (
        <>
          <NextAction
            label={nextLabel}
            busy={autoPassing}
            countdown={autoPassCountdown}
            onHoldPriority={onHoldPriority}
            onNext={() => send({ type: input.type, output: { type: "pass", exhaustStack: false } })}
          />
        </>
      );
      break;
    case "payManaCost":
      controls = (
        <>
          <p>
            {input.cardName} · <ManaText text={input.manaCost} />
          </p>
          <button
            className="duel-primary"
            onClick={
              onAutoPay ?? (() => send({ type: input.type, output: { type: "pay", auto: true } }))
            }
          >
            <GameIcon name="auto-pay" /> Auto-pay mana
          </button>
          {input.canConfirmFromPool && (
            <button
              onClick={() => send({ type: input.type, output: { type: "pay", auto: false } })}
            >
              <GameIcon name="mana-pool" /> Pay from pool
            </button>
          )}
          <button onClick={() => send({ type: input.type, output: { type: "cancel" } })}>
            <GameIcon name="cancel" /> Cancel casting
          </button>
        </>
      );
      break;
    case "chooseAttackers": {
      const assignments = selected.map((id) => ({
        attackerId: id,
        targetId: blocks[id] ?? input.attackers.find((a) => a.attackerId === id)!.validTargetIds[0],
      }));
      const missingRequired = input.attackers.some(
        (a) => a.mustAttack && !selected.includes(a.attackerId),
      );
      controls = (
        <>
          <p>Select attackers on the battlefield or below.</p>
          <button
            onClick={() =>
              onSelected(
                selected.length === input.attackers.length
                  ? input.attackers.filter((a) => a.mustAttack).map((a) => a.attackerId)
                  : input.attackers.map((a) => a.attackerId),
              )
            }
          >
            {selected.length === input.attackers.length
              ? "Clear optional attackers"
              : "Select all attackers"}
          </button>
          {input.attackers.map((a) => (
            <div key={a.attackerId}>
              <button
                data-selected={selected.includes(a.attackerId)}
                onClick={() => toggle(a.attackerId)}
              >
                {selected.includes(a.attackerId) ? "✓ " : ""}
                {name(a.attackerId)}
                {a.mustAttack ? " (must attack)" : ""}
              </button>
              {a.validTargetIds.length > 1 && (
                <select
                  value={blocks[a.attackerId] ?? a.validTargetIds[0]}
                  onChange={(e) => onBlocks({ ...blocks, [a.attackerId]: e.target.value })}
                >
                  {a.validTargetIds.map((id) => (
                    <option key={id} value={id}>
                      {input.attackTargets.find((t) => t.id === id)?.label ?? name(id)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <button
            className="duel-primary"
            disabled={missingRequired}
            onClick={() =>
              send({ type: input.type, output: { type: "declareAttackers", assignments } })
            }
          >
            <GameIcon name="attack" />
            {selected.length ? `Attack with ${selected.length}` : "No attacks"}
          </button>
        </>
      );
      break;
    }
    case "chooseBlockers":
      controls = (
        <>
          <p>Click a glowing blocker, then an attacker. Or drag between them.</p>
          {input.availableBlockerIds.map((id) => (
            <label key={id}>
              {name(id)}
              <select
                value={blocks[id] ?? ""}
                onChange={(e) => onBlocks({ ...blocks, [id]: e.target.value })}
              >
                <option value="">Do not block</option>
                {input.attackers
                  .filter((a) => a.validBlockerIds.includes(id))
                  .map((a) => (
                    <option key={a.attackerId} value={a.attackerId}>
                      {name(a.attackerId)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {Object.values(blocks).some(Boolean) && (
            <button
              onClick={() => {
                onBlocks({});
                onSelected([]);
              }}
            >
              <GameIcon name="cancel" /> Clear blocks
            </button>
          )}
          {input.error && <p>{input.error}</p>}
        </>
      );
      confirmation = (
        <button
          className="duel-primary"
          onClick={() =>
            send({
              type: input.type,
              output: {
                type: "declareBlockers",
                assignments: Object.entries(blocks)
                  .filter(([, id]) => id)
                  .map(([blockerId, attackerId]) => ({ blockerId, attackerId })),
              },
            })
          }
        >
          <GameIcon name="block" />
          {Object.values(blocks).filter(Boolean).length
            ? `Block with ${Object.values(blocks).filter(Boolean).length}`
            : "No blocks"}
        </button>
      );
      break;
    case "mulliganPutBack":
    case "chooseCards": {
      const options = input.type === "chooseCards" ? input.cards : input.cards;
      const min = input.type === "chooseCards" ? input.min : input.count;
      const max = input.type === "chooseCards" ? input.max : input.count;
      controls = (
        <>
          <p>Select {min === max ? min : `${min}–${max}`} cards.</p>
          {options.map((c) => (
            <button key={c.id} data-selected={selected.includes(c.id)} onClick={() => toggle(c.id)}>
              {selected.includes(c.id) ? "✓ " : ""}
              {c.identity.name}
            </button>
          ))}
          <button
            disabled={selected.length < min || selected.length > max}
            onClick={() =>
              send(
                input.type === "chooseCards"
                  ? {
                      type: input.type,
                      output: { type: "chooseCardsDecision", chosenCardIds: selected },
                    }
                  : {
                      type: input.type,
                      output: { type: "mulliganPutBackDecision", cardIds: selected },
                    },
              )
            }
          >
            <GameIcon name="confirm" /> Confirm cards
          </button>
        </>
      );
      break;
    }
    case "chooseBoolean":
      controls = (
        <>
          <p>{input.presentation.title}</p>
          {[true, false].map((value) => (
            <button
              key={String(value)}
              onClick={() => send({ type: input.type, output: { type: "decision", value } })}
            >
              {value ? input.confirmLabel : input.denyLabel}
            </button>
          ))}
        </>
      );
      break;
    case "chooseDamageAssignmentOrder": {
      const order = [...selected, ...input.blockerIds.filter((id) => !selected.includes(id))];
      controls = (
        <>
          <p>Click blockers in damage order.</p>
          {input.blockerIds.map((id) => (
            <button key={id} onClick={() => toggle(id)}>
              {order.indexOf(id) + 1}. {name(id)}
            </button>
          ))}
          <button
            onClick={() =>
              send({
                type: input.type,
                output: { type: "damageAssignmentOrderDecision", orderedBlockerIds: order },
              })
            }
          >
            Confirm order
          </button>
        </>
      );
      break;
    }
    case "chooseCombatDamageAssignment": {
      const ids = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
      const total = ids.reduce((sum, id) => sum + (amounts[id] ?? 0), 0);
      controls = (
        <>
          <p>
            Assign {input.totalDamage} damage ({total} assigned).
          </p>
          {ids.map((id) => (
            <label key={id}>
              {id === input.defenderId ? "Defender" : name(id)}
              <input
                type="number"
                min={0}
                max={input.totalDamage}
                value={amounts[id] ?? 0}
                onChange={(e) => setAmounts({ ...amounts, [id]: Number(e.target.value) })}
              />
            </label>
          ))}
          <button
            disabled={total !== input.totalDamage}
            onClick={() =>
              send({
                type: input.type,
                output: {
                  type: "combatDamageAssignmentDecision",
                  assignments: ids.map((id) => ({ assigneeId: id, damage: amounts[id] ?? 0 })),
                },
              })
            }
          >
            Assign damage
          </button>
        </>
      );
      break;
    }
    case "revealCards":
      controls = (
        <>
          {input.cards.map((c) => (
            <p key={c.id}>{c.identity.name}</p>
          ))}
          <button
            onClick={() => send({ type: input.type, output: { type: "revealCardsAcknowledged" } })}
          >
            Continue
          </button>
        </>
      );
      break;
    case "gameOver":
      controls = <p>Match finished.</p>;
      break;
    default:
      controls = <ExtraDuelChoices input={input} send={send} />;
  }
  const title =
    "presentation" in input ? input.presentation.title : input.type.replace(/([A-Z])/g, " $1");
  return (
    <section className="arena-actions duel-prompt" data-choice={input.type}>
      <small>YOUR DECISION</small>
      {input.type !== "chooseAction" && <strong>{title}</strong>}
      <div className="duel-prompt-options">
        <ChoicePages>{controls}</ChoicePages>
      </div>
      {confirmation && <div className="duel-prompt-confirmation">{confirmation}</div>}
    </section>
  );
}
