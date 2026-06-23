import { useState, useCallback, useEffect, useMemo } from "react";
import type { Prompt } from "@/protocol";
import type { PromptOutput } from "@/protocol";
import { TargetingIntent, intentIsHostile } from "@/types/promptType";
import { useTargetIntentStore } from "@/stores/useTargetIntentStore";

/** Prompt types that are part of the spell-casting flow. */
const CASTING_PROMPT_TYPES = new Set(["chooseBoardTargets", "payManaCost"]);

interface UseCastingStateOptions {
  currentPrompt: Prompt | null | undefined;
  respond: (output: PromptOutput["output"]) => void;
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
  const [targetIntent, setTargetIntent] = useState<TargetingIntent>(TargetingIntent.Hostile);
  const activeTargetPrompt =
    currentPrompt?.input.type === "chooseBoardTargets" ? currentPrompt : null;
  const clearLockedTarget = useCallback(() => {
    setTargetId(null);
    setTargetIntent(TargetingIntent.Hostile);
  }, []);

  const targetingInput =
    currentPrompt?.input.type === "chooseBoardTargets" ? currentPrompt.input : null;
  const promptIntent = targetingInput?.intent ?? TargetingIntent.Hostile;

  const [prevCastingCardId, setPrevCastingCardId] = useState(castingCardId);
  const [prevTargetPrompt, setPrevTargetPrompt] = useState(activeTargetPrompt);
  if (prevCastingCardId !== castingCardId) {
    setPrevCastingCardId(castingCardId);
    clearLockedTarget();
  }
  if (prevTargetPrompt !== activeTargetPrompt) {
    setPrevTargetPrompt(activeTargetPrompt);
    if (activeTargetPrompt) clearLockedTarget();
  }
  useEffect(() => {
    return () => {
      if (castingCardId) useTargetIntentStore.getState().clearIntent(castingCardId);
    };
  }, [castingCardId]);

  // Whether we're in the targeting phase (arrow follows cursor).
  const isTargeting = promptType === "chooseBoardTargets";

  const arrowIntent: TargetingIntent = targetId ? targetIntent : promptIntent;
  const arrowHostile = intentIsHostile(arrowIntent);

  const lockTarget = useCallback(
    (kind: "card" | "player", id: string) => {
      if (!castingCardId) return;
      setTargetId(id);
      setTargetIntent(promptIntent);
      useTargetIntentStore.getState().setIntent(castingCardId, { kind, id });
    },
    [castingCardId, promptIntent],
  );

  const wrappedTargetCard = useCallback(
    (cardId: string | null) => {
      if (cardId) lockTarget("card", cardId);
      respond({
        type: "boardTargets",
        chosen: cardId ? [{ kind: "card", id: cardId, intent: promptIntent }] : [],
      });
    },
    [respond, lockTarget, promptIntent],
  );

  const wrappedTargetPlayer = useCallback(
    (playerId: string) => {
      lockTarget("player", playerId);
      respond({
        type: "boardTargets",
        chosen: [{ kind: "player", id: playerId, intent: promptIntent }],
      });
    },
    [respond, lockTarget, promptIntent],
  );

  const wrappedTargetSpell = useCallback(
    (spellId: string | null) => {
      respond({
        type: "boardTargets",
        chosen: spellId ? [{ kind: "spell", id: spellId, intent: promptIntent }] : [],
      });
    },
    [respond, promptIntent],
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
