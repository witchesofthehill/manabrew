import { useState, useCallback, useEffect, useMemo } from "react";
import type { AgentPrompt } from "@/stores/useGameStore";
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

interface UseCastingStateOptions {
  currentPrompt: AgentPrompt | null | undefined;
  targetCard: (cardId: string | null) => void;
  targetPlayer: (playerId: string) => void;
  targetAny: (target: { kind: string; playerId?: string; cardId?: string }) => void;
}

export function useCastingState({
  currentPrompt,
  targetCard,
  targetPlayer,
  targetAny,
}: UseCastingStateOptions) {
  const promptType = currentPrompt?.type;

  const castingCardId = useMemo(() => {
    if (!promptType || !CASTING_PROMPT_TYPES.has(promptType)) return null;
    return currentPrompt?.sourceCardId ?? currentPrompt?.cardId ?? null;
  }, [promptType, currentPrompt?.sourceCardId, currentPrompt?.cardId]);

  // Track the chosen target so the arrow persists through cost payment
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetHostile, setTargetHostile] = useState(false);
  const [targetIntent, setTargetIntent] = useState<TargetingIntent>(TargetingIntent.Hostile);

  // Whether the engine says the current effect is hostile
  const promptHostile = currentPrompt?.hostile ?? true;
  const promptIntent =
    currentPrompt?.intent ?? (promptHostile ? TargetingIntent.Hostile : TargetingIntent.Friendly);

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
      targetCard(cardId);
    },
    [targetCard, castingCardId, promptHostile, promptIntent],
  );

  const wrappedTargetPlayer = useCallback(
    (playerId: string) => {
      if (castingCardId) {
        setTargetId(playerId);
        setTargetHostile(promptHostile);
        setTargetIntent(promptIntent);
        useTargetIntentStore.getState().setIntent(castingCardId, { kind: "player", id: playerId });
      }
      targetPlayer(playerId);
    },
    [targetPlayer, castingCardId, promptHostile, promptIntent],
  );

  const wrappedTargetAny = useCallback(
    (target: { kind: string; playerId?: string; cardId?: string }) => {
      const id = target.cardId ?? target.playerId ?? null;
      if (castingCardId && id) {
        setTargetId(id);
        setTargetHostile(promptHostile);
        setTargetIntent(promptIntent);
        const kind: "card" | "player" =
          target.kind === "player" || target.playerId ? "player" : "card";
        useTargetIntentStore.getState().setIntent(castingCardId, { kind, id });
      }
      targetAny(target);
    },
    [targetAny, castingCardId, promptHostile, promptIntent],
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
