import type { PromptResolver } from "./promptHandlers";
import { useTargetIntentStore } from "@/stores/useTargetIntentStore";

function canFinishTargeting(input: {
  minTargets: number;
  maxTargets: number;
  chosenTargets: number;
}): boolean {
  return input.maxTargets > input.minTargets && input.chosenTargets >= input.minTargets;
}

export const singleLegalBoardTarget: PromptResolver<"chooseBoardTargets"> = (prompt, ctx) => {
  const input = prompt.input;
  if (canFinishTargeting(input)) return { kind: "force-show" };

  const sourceId = prompt.sourceCardId;
  const intent = sourceId ? ctx.targetIntents[sourceId] : undefined;
  if (intent) {
    const match = input.candidates.find((c) => c.kind === intent.kind && c.id === intent.id);
    if (match) {
      useTargetIntentStore.getState().clearIntent(sourceId!);
      return {
        kind: "auto",
        respond: { type: "boardTargets", chosen: [match] },
        reason: `pre-selected target ${match.id}`,
      };
    }
  }

  if (input.candidates.length !== 1) return { kind: "force-show" };
  const only = input.candidates[0];
  return {
    kind: "auto",
    respond: { type: "boardTargets", chosen: [only] },
    reason: `single legal target: ${only.id}`,
  };
};

export const forcedAllSelections: PromptResolver<"chooseFromSelection"> = (prompt) => {
  const opts = prompt.input.options;
  const min = prompt.input.minChoices;
  const max = prompt.input.maxChoices;
  if (opts.length === 0) return { kind: "force-show" };
  if (min !== max || min !== opts.length) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "selectionDecision", chosenIndices: opts.map((_, i) => i) },
    reason: `must pick all ${opts.length} options`,
  };
};

export const singleLegalColor: PromptResolver<"chooseColor"> = (prompt) => {
  const { validColors, amount } = prompt.input;
  // Only auto-resolve a plain single pick with exactly one legal colour.
  if (amount !== 1 || validColors.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "colorDecision", chosenColors: { [validColors[0]]: 1 } },
    reason: `only legal colour: ${validColors[0]}`,
  };
};

export const singleLegalNumber: PromptResolver<"chooseNumber"> = (prompt) => {
  const min = prompt.input.min;
  const max = prompt.input.max;
  if (min == null || max == null || min !== max) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "numberDecision", chosenNumber: min },
    reason: `only legal number: ${min}`,
  };
};

export const forcedCardChoice: PromptResolver<"chooseCards"> = (prompt) => {
  const ids = prompt.input.cards.map((c) => c.id);
  const { min, max } = prompt.input;
  if (max <= 0) {
    return {
      kind: "auto",
      respond: { type: "chooseCardsDecision", chosenCardIds: [] },
      reason: "no cards to choose",
    };
  }
  if (min >= ids.length) {
    return {
      kind: "auto",
      respond: { type: "chooseCardsDecision", chosenCardIds: ids },
      reason: `must pick all ${ids.length} cards`,
    };
  }
  return { kind: "force-show" };
};

export const singleBlockerOrder: PromptResolver<"chooseDamageAssignmentOrder"> = (prompt) => {
  const blockers = prompt.input.blockerIds;
  if (blockers.length > 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "damageAssignmentOrderDecision", orderedBlockerIds: blockers },
    reason: `≤1 blocker (${blockers.length})`,
  };
};

export const singleAssigneeDamage: PromptResolver<"chooseCombatDamageAssignment"> = (prompt) => {
  const blockers = prompt.input.blockerIds;
  const defenderId = prompt.input.defenderId ?? null;
  const total = prompt.input.totalDamage ?? 0;
  const assignees = blockers.length + (defenderId ? 1 : 0);
  if (assignees !== 1) return { kind: "force-show" };
  const target = blockers[0] ?? defenderId!;
  return {
    kind: "auto",
    respond: {
      type: "combatDamageAssignmentDecision",
      assignments: [{ assigneeId: target, damage: total }],
    },
    reason: `single assignee (${target}) gets all ${total} damage`,
  };
};

export const emptyScry: PromptResolver<"scry"> = (prompt) => {
  if (prompt.input.cards.length > 0) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "scryDecision", zoneCardIds: prompt.input.zones.map(() => []) },
    reason: "scry with 0 revealed cards",
  };
};

export const singleCardOrder: PromptResolver<"reorderCards"> = (prompt) => {
  const ids = prompt.input.cards.map((c) => c.id);
  if (ids.length > 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "reorderDecision", orderedCardIds: ids },
    reason: `≤1 card to order (${ids.length})`,
  };
};
