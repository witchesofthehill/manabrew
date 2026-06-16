import type { PromptResolver, ResolveCtx } from "./promptHandlers";
import { useTargetIntentStore } from "@/stores/useTargetIntentStore";

function consumeIntentForCard(
  prompt: { sourceCardId?: string; input: { validCardIds: string[] } },
  ctx: ResolveCtx,
): string | null {
  const sourceId = prompt.sourceCardId;
  if (!sourceId) return null;
  const intent = ctx.targetIntents[sourceId];
  if (!intent || intent.kind !== "card") return null;
  if (!prompt.input.validCardIds.includes(intent.id)) return null;
  useTargetIntentStore.getState().clearIntent(sourceId);
  return intent.id;
}

function consumeIntentForPlayer(
  prompt: { sourceCardId?: string; input: { validPlayerIds: string[] } },
  ctx: ResolveCtx,
): string | null {
  const sourceId = prompt.sourceCardId;
  if (!sourceId) return null;
  const intent = ctx.targetIntents[sourceId];
  if (!intent || intent.kind !== "player") return null;
  if (!prompt.input.validPlayerIds.includes(intent.id)) return null;
  useTargetIntentStore.getState().clearIntent(sourceId);
  return intent.id;
}

function consumeIntentForSpell(
  prompt: { sourceCardId?: string; input: { validSpellIds: string[] } },
  ctx: ResolveCtx,
): string | null {
  const sourceId = prompt.sourceCardId;
  if (!sourceId) return null;
  const intent = ctx.targetIntents[sourceId];
  if (!intent || intent.kind !== "spell") return null;
  if (!prompt.input.validSpellIds.includes(intent.id)) return null;
  useTargetIntentStore.getState().clearIntent(sourceId);
  return intent.id;
}

function canFinishTargeting(input: {
  minTargets: number;
  maxTargets: number;
  chosenTargets: number;
}): boolean {
  return input.maxTargets > input.minTargets && input.chosenTargets >= input.minTargets;
}

export const singleLegalCard: PromptResolver<"chooseTargetCard" | "chooseTargetCardFromZone"> = (
  prompt,
  ctx,
) => {
  if (prompt.input.type === "chooseTargetCard" && canFinishTargeting(prompt.input)) {
    return { kind: "force-show" };
  }
  const preselected = consumeIntentForCard(prompt, ctx);
  if (preselected) {
    return {
      kind: "auto",
      respond: { type: "targetCard", cardId: preselected },
      reason: `pre-selected target ${preselected}`,
    };
  }
  const ids = prompt.input.validCardIds;
  if (ids.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "targetCard", cardId: ids[0] },
    reason: `single legal target: ${ids[0]}`,
  };
};

export const singleLegalPlayer: PromptResolver<"chooseTargetPlayer"> = (prompt, ctx) => {
  if (canFinishTargeting(prompt.input)) return { kind: "force-show" };
  const preselected = consumeIntentForPlayer(prompt, ctx);
  if (preselected) {
    return {
      kind: "auto",
      respond: { type: "targetPlayer", playerId: preselected },
      reason: `pre-selected player ${preselected}`,
    };
  }
  const ids = prompt.input.validPlayerIds;
  if (ids.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "targetPlayer", playerId: ids[0] },
    reason: `single legal player: ${ids[0]}`,
  };
};

export const singleLegalSpell: PromptResolver<"chooseTargetSpell"> = (prompt, ctx) => {
  if (canFinishTargeting(prompt.input)) return { kind: "force-show" };
  const preselected = consumeIntentForSpell(prompt, ctx);
  if (preselected) {
    return {
      kind: "auto",
      respond: { type: "targetSpell", spellId: preselected },
      reason: `pre-selected spell ${preselected}`,
    };
  }
  const ids = prompt.input.validSpellIds;
  if (ids.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "targetSpell", spellId: ids[0] },
    reason: `single legal spell: ${ids[0]}`,
  };
};

export const forcedAllModes: PromptResolver<"chooseMode"> = (prompt) => {
  const opts = prompt.input.options;
  const min = prompt.input.minChoices;
  const max = prompt.input.maxChoices;
  if (opts.length === 0) return { kind: "force-show" };
  if (min !== max || min !== opts.length) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "modeDecision", chosenIndices: opts.map((_, i) => i) },
    reason: `must pick all ${opts.length} modes`,
  };
};

export const singleLegalColor: PromptResolver<"chooseColor"> = (prompt) => {
  const colors = prompt.input.validColors;
  if (colors.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "colorDecision", color: colors[0] },
    reason: `only legal colour: ${colors[0]}`,
  };
};

export const singleLegalType: PromptResolver<"chooseType"> = (prompt) => {
  const types = prompt.input.validTypes;
  if (types.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "typeDecision", chosenType: types[0] },
    reason: `only legal type: ${types[0]}`,
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

export const singleLegalName: PromptResolver<"chooseCardName"> = (prompt) => {
  const names = prompt.input.validNames;
  if (names.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "cardNameDecision", chosenName: names[0] },
    reason: `only legal name: ${names[0]}`,
  };
};

export const allCardsForced: PromptResolver<"chooseCardsForEffect"> = (prompt) => {
  const ids = prompt.input.validCardIds;
  const min = prompt.input.minChoices;
  const max = prompt.input.maxChoices;
  if (ids.length === 0) return { kind: "force-show" };
  if (min == null || max == null || min !== max || min !== ids.length) {
    return { kind: "force-show" };
  }
  return {
    kind: "auto",
    respond: { type: "chooseCardsDecision", chosenCardIds: ids },
    reason: `must pick all ${ids.length} cards`,
  };
};

export const singleAlternativeCost: PromptResolver<"chooseAlternativeCost"> = (prompt) => {
  const opts = prompt.input.options;
  if (opts.length !== 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "alternativeCostDecision", chosenIndex: 0 },
    reason: "only one castable cost option",
  };
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

export const singleLegalAny: PromptResolver<"chooseTargetAny"> = (prompt, ctx) => {
  if (canFinishTargeting(prompt.input)) return { kind: "force-show" };
  const preCard = consumeIntentForCard(prompt, ctx);
  if (preCard) {
    return {
      kind: "auto",
      respond: { type: "targetAny", target: { kind: "card", cardId: preCard } },
      reason: `pre-selected target (card ${preCard})`,
    };
  }
  const prePlayer = consumeIntentForPlayer(prompt, ctx);
  if (prePlayer) {
    return {
      kind: "auto",
      respond: { type: "targetAny", target: { kind: "player", playerId: prePlayer } },
      reason: `pre-selected target (player ${prePlayer})`,
    };
  }
  const cards = prompt.input.validCardIds;
  const players = prompt.input.validPlayerIds;
  const total = cards.length + players.length;
  if (total !== 1) return { kind: "force-show" };
  if (cards.length === 1) {
    return {
      kind: "auto",
      respond: { type: "targetAny", target: { kind: "card", cardId: cards[0] } },
      reason: `single legal target (card ${cards[0]})`,
    };
  }
  if (players.length === 1) {
    return {
      kind: "auto",
      respond: { type: "targetAny", target: { kind: "player", playerId: players[0] } },
      reason: `single legal target (player ${players[0]})`,
    };
  }
  return { kind: "force-show" };
};

export const forcedDiscard: PromptResolver<"chooseDiscard"> = (prompt) => {
  const hand = prompt.input.handCardIds;
  const required = prompt.input.numToDiscard;
  if (required <= 0) {
    return {
      kind: "auto",
      respond: { type: "discardDecision", discardedCardIds: [] },
      reason: "discard 0 cards",
    };
  }
  if (required >= hand.length) {
    return {
      kind: "auto",
      respond: { type: "discardDecision", discardedCardIds: hand },
      reason: `discard entire hand (${hand.length} cards)`,
    };
  }
  return { kind: "force-show" };
};

export const emptyScry: PromptResolver<"scry"> = (prompt) => {
  const cards = prompt.input.cardIds;
  if (cards.length > 0) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "scryDecision", bottomCardIds: [] },
    reason: "scry with 0 revealed cards",
  };
};

export const emptySurveil: PromptResolver<"surveil"> = (prompt) => {
  const cards = prompt.input.cardIds;
  if (cards.length > 0) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "surveilDecision", graveyardCardIds: [] },
    reason: "surveil with 0 revealed cards",
  };
};

export const emptyDig: PromptResolver<"dig"> = (prompt) => {
  const cards = prompt.input.cardIds;
  if (cards.length > 0) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "digDecision", chosenCardIds: [] },
    reason: "dig with 0 revealed cards",
  };
};

export const singleCardOrder: PromptResolver<"reorderLibrary"> = (prompt) => {
  const ids = prompt.input.cardIds;
  if (ids.length > 1) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "reorderLibraryDecision", orderedCardIds: ids },
    reason: `≤1 card to order (${ids.length})`,
  };
};
