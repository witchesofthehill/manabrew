import type { PromptResolver } from "./promptHandlers";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { TRIGGER_ORDER_PROMPT_TITLE } from "@/components/game/game.constants";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function canFinishTargeting(input: {
  minTargets: number;
  maxTargets: number;
  chosenTargets: number;
}): boolean {
  return input.maxTargets > input.minTargets && input.chosenTargets >= input.minTargets;
}

export const singleLegalBoardTarget: PromptResolver<"chooseBoardTargets"> = (prompt) => {
  const input = prompt.input;
  if (canFinishTargeting(input)) return { kind: "force-show" };

  if (input.candidates.length !== 1) return { kind: "force-show" };
  const only = input.candidates[0];
  return {
    kind: "auto",
    respond: { type: "boardTargets", chosen: [only] },
    reason: i18n._(msg`single legal target: ${only.id}`),
  };
};

export const forcedAllSelections: PromptResolver<"chooseFromSelection"> = (prompt) => {
  const opts = prompt.input.options;
  const min = prompt.input.minTotal;
  const max = prompt.input.maxTotal;
  if (opts.length === 0) return { kind: "force-show" };
  if (opts.some((o) => o.canRepeat || o.weight !== 1)) return { kind: "force-show" };
  if (min !== max || min !== opts.length) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "selectionDecision", chosenIndices: opts.map((_, i) => i) },
    reason: i18n._(msg`must pick all ${opts.length} options`),
  };
};

export const singleLegalColor: PromptResolver<"chooseColor"> = (prompt) => {
  const { validColors, amount } = prompt.input;
  // Only auto-resolve a plain single pick with exactly one legal colour.
  if (amount !== 1 || validColors.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "colorDecision", chosenColors: { [validColors[0]]: 1 } },
    reason: i18n._(msg`only legal colour: ${validColors[0]}`),
  };
};

export const singleLegalNumber: PromptResolver<"chooseNumber"> = (prompt) => {
  const min = prompt.input.min;
  const max = prompt.input.max;
  if (min == null || max == null || min !== max) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "numberDecision", chosenNumber: min },
    reason: i18n._(msg`only legal number: ${min}`),
  };
};

export const forcedCardChoice: PromptResolver<"chooseCards"> = (prompt) => {
  const ids = prompt.input.cards.map((c) => c.id);
  const { min, max } = prompt.input;
  if (max <= 0) {
    return {
      kind: "auto",
      respond: { type: "chooseCardsDecision", chosenCardIds: [] },
      reason: i18n._(msg`no cards to choose`),
    };
  }
  if (min >= ids.length) {
    return {
      kind: "auto",
      respond: { type: "chooseCardsDecision", chosenCardIds: ids },
      reason: i18n._(msg`must pick all ${ids.length} cards`),
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
    reason: i18n._(msg`≤1 blocker (${blockers.length})`),
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
    reason: i18n._(msg`single assignee (${target}) gets all ${total} damage`),
  };
};

export const emptyScry: PromptResolver<"scry"> = (prompt) => {
  if (prompt.input.cards.length > 0) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "scryDecision", zoneCardIds: prompt.input.zones.map(() => []) },
    reason: i18n._(msg`scry with 0 revealed cards`),
  };
};

export const singleCardOrder: PromptResolver<"reorder"> = (prompt) => {
  const ids = prompt.input.items.map((i) => i.id);
  if (ids.length <= 1) {
    return {
      kind: "auto",
      respond: { type: "reorderDecision", orderedIds: ids },
      reason: i18n._(msg`≤1 card to order (${ids.length})`),
    };
  }
  const isTriggerOrder = prompt.input.presentation.title === TRIGGER_ORDER_PROMPT_TITLE;
  if (isTriggerOrder && !usePreferencesStore.getState().chooseOrderOnMultipleTriggers) {
    return {
      kind: "auto",
      respond: { type: "reorderDecision", orderedIds: shuffled(ids) },
      reason: i18n._(msg`trigger ordering disabled — random order`),
    };
  }
  return { kind: "force-show" };
};
