import { useState, useCallback, useEffect, useMemo } from "react";
import type { Prompt } from "@/protocol";
import type { PromptOutput } from "@/protocol";
import { TargetingIntent } from "@/types/promptType";
import { useTargetIntentStore } from "@/stores/useTargetIntentStore";

/** Prompt types that are part of the spell-casting flow. */
const CASTING_PROMPT_TYPES = new Set([
  "chooseBoardTargets",
  "payManaCost",
  "payCombatCost",
  "chooseDelve",
  "specifyManaCombo",
]);

interface UseCastingStateOptions {
  currentPrompt: Prompt | null | undefined;
  respond: (output: PromptOutput) => void;
}

export function useCastingState({ currentPrompt, respond }: UseCastingStateOptions) {
  const promptType = currentPrompt?.input.type;

  const castingCardId = useMemo(() => {
    if (!promptType || !CASTING_PROMPT_TYPES.has(promptType)) return null;
    return (
      currentPrompt?.sourceCardId ??
      (promptType === "payManaCost" ? currentPrompt.input.cardId : null)
    );
  }, [promptType, currentPrompt]);

  // Track the chosen target so the arrow persists through cost payment
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetHostile, setTargetHostile] = useState(false);
  const [targetIntent, setTargetIntent] = useState<TargetingIntent>(TargetingIntent.Hostile);

  // Whether the engine says the current effect is hostile
  const targetingInput =
    currentPrompt?.input.type === "chooseBoardTargets" ? currentPrompt.input : null;
  const promptHostile = targetingInput?.hostile ?? true;
  const promptIntent =
    targetingInput?.intent ?? (promptHostile ? TargetingIntent.Hostile : TargetingIntent.Friendly);

  const [prevCastingCardId, setPrevCastingCardId] = useState(castingCardId);
  if (prevCastingCardId !== castingCardId) {
    setPrevCastingCardId(castingCardId);
    setTargetId(null);
    setTargetHostile(false);
    setTargetIntent(TargetingIntent.Hostile);
  }
  useEffect(() => {
    return () => {
      if (castingCardId) useTargetIntentStore.getState().clearIntent(castingCardId);
    };
  }, [castingCardId]);

  // Whether we're in the targeting phase (arrow follows cursor).
  const isTargeting = promptType === "chooseBoardTargets";

  // Arrow hostility: use locked value if target chosen, else prompt value
  const arrowHostile = targetId ? targetHostile : promptHostile;
  const arrowIntent: TargetingIntent = targetId ? targetIntent : promptIntent;

  const lockTarget = useCallback(
    (kind: "card" | "player", id: string) => {
      if (!castingCardId) return;
      setTargetId(id);
      setTargetHostile(promptHostile);
      setTargetIntent(promptIntent);
      useTargetIntentStore.getState().setIntent(castingCardId, { kind, id });
    },
    [castingCardId, promptHostile, promptIntent],
  );

  const wrappedTargetCard = useCallback(
    (cardId: string | null) => {
      if (cardId) lockTarget("card", cardId);
      respond({ type: "boardTargets", chosen: cardId ? [{ kind: "card", id: cardId }] : [] });
    },
    [respond, lockTarget],
  );

  const wrappedTargetPlayer = useCallback(
    (playerId: string) => {
      lockTarget("player", playerId);
      respond({ type: "boardTargets", chosen: [{ kind: "player", id: playerId }] });
    },
    [respond, lockTarget],
  );

  const wrappedTargetSpell = useCallback(
    (spellId: string | null) => {
      respond({ type: "boardTargets", chosen: spellId ? [{ kind: "spell", id: spellId }] : [] });
    },
    [respond],
  );

  const declineTargets = useCallback(() => {
    respond({ type: "boardTargets", chosen: [] });
  }, [respond]);

  return {
    /** The card ID being cast, or null. */
    castingCardId,
    /** Whether the casting arrow should follow the cursor (targeting phase). */
    isTargeting,
    /** The locked target ID after the player chose a target. */
    targetId,
    /** Legacy hostile flag — kept for any consumer that hasn't migrated to `arrowIntent`. */
    arrowHostile,
    /** Semantic intent driving pointer icon + glow colour. */
    arrowIntent,
    /** Whether there's an active casting arrow to show. */
    showArrow: !!castingCardId && (isTargeting || !!targetId),
    /** Wrapped target actions that track the chosen target. */
    wrappedTargetCard,
    wrappedTargetPlayer,
    wrappedTargetSpell,
    declineTargets,
  };
}
