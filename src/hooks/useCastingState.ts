import { useState, useCallback, useEffect, useMemo } from "react";
import type { Prompt } from "@/protocol";
import type { PromptOutput } from "@/protocol";
import { TargetingIntent } from "@/types/promptType";
import { useTargetIntentStore } from "@/stores/useTargetIntentStore";

/** Prompt types that are part of the spell-casting flow. */
const CASTING_PROMPT_TYPES = new Set([
  "chooseTargetCard",
  "chooseTargetPlayer",
  "chooseTargetAny",
  "chooseTargetCardFromZone",
  "chooseTargetSpell",
  "payManaCost",
  "payCombatCost",
  "chooseDelve",
  "chooseConvoke",
  "chooseImprovise",
  "specifyManaCombo",
]);

type TargetAnyChoice = Extract<PromptOutput, { type: "targetAny" }>["target"];

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
    currentPrompt?.input.type === "chooseTargetCard" ||
    currentPrompt?.input.type === "chooseTargetPlayer" ||
    currentPrompt?.input.type === "chooseTargetAny" ||
    currentPrompt?.input.type === "chooseTargetCardFromZone" ||
    currentPrompt?.input.type === "chooseTargetSpell"
      ? currentPrompt.input
      : null;
  const promptHostile =
    targetingInput != null && "hostile" in targetingInput ? (targetingInput.hostile ?? true) : true;
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

  // Whether we're in the targeting phase (arrow follows cursor). Zone targets
  // are chosen from a modal, not the board, so they never enter arrow mode.
  const isTargeting =
    (promptType?.startsWith("chooseTarget") ?? false) && promptType !== "chooseTargetCardFromZone";

  // Arrow hostility: use locked value if target chosen, else prompt value
  const arrowHostile = targetId ? targetHostile : promptHostile;
  const arrowIntent: TargetingIntent = targetId ? targetIntent : promptIntent;

  // Wrapped target actions that record the chosen target
  const wrappedTargetCard = useCallback(
    (cardId: string | null) => {
      if (cardId && castingCardId) {
        setTargetId(cardId);
        setTargetHostile(promptHostile);
        setTargetIntent(promptIntent);
        useTargetIntentStore.getState().setIntent(castingCardId, { kind: "card", id: cardId });
      }
      respond({ type: "targetCard", cardId });
    },
    [respond, castingCardId, promptHostile, promptIntent],
  );

  const wrappedTargetPlayer = useCallback(
    (playerId: string) => {
      if (castingCardId) {
        setTargetId(playerId);
        setTargetHostile(promptHostile);
        setTargetIntent(promptIntent);
        useTargetIntentStore.getState().setIntent(castingCardId, { kind: "player", id: playerId });
      }
      respond({ type: "targetPlayer", playerId });
    },
    [respond, castingCardId, promptHostile, promptIntent],
  );

  const wrappedTargetAny = useCallback(
    (target: TargetAnyChoice) => {
      if (castingCardId && target.kind !== "none") {
        const id = target.kind === "card" ? target.cardId : target.playerId;
        setTargetHostile(promptHostile);
        setTargetIntent(promptIntent);
        setTargetId(id);
        useTargetIntentStore.getState().setIntent(castingCardId, { kind: target.kind, id });
      }
      respond({ type: "targetAny", target });
    },
    [respond, castingCardId, promptHostile, promptIntent],
  );

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
    wrappedTargetAny,
  };
}
