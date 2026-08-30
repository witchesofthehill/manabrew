import { useState, useCallback, useMemo } from "react";
import type { Prompt } from "@/protocol";
import type { PromptOutput } from "@/protocol";
import { TargetingIntent } from "@/types/promptType";

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
      currentPrompt?.sourceCard?.id ??
      (promptType === "payManaCost" ? currentPrompt.input.cardId : null)
    );
  }, [promptType, currentPrompt]);

  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetHostile, setTargetHostile] = useState(false);
  const [targetIntent, setTargetIntent] = useState<TargetingIntent>(TargetingIntent.Hostile);

  const targetingInput =
    currentPrompt?.input.type === "chooseBoardTargets" ? currentPrompt.input : null;
  const promptHostile = targetingInput?.hostile ?? true;
  const promptIntent =
    targetingInput?.intent ?? (promptHostile ? TargetingIntent.Hostile : TargetingIntent.Friendly);

  const [prevPrompt, setPrevPrompt] = useState(currentPrompt);
  const [prevCastingCardId, setPrevCastingCardId] = useState(castingCardId);
  if (prevPrompt !== currentPrompt) {
    setPrevPrompt(currentPrompt);
    setPrevCastingCardId(castingCardId);
    if (promptType === "chooseBoardTargets" || castingCardId !== prevCastingCardId) {
      setTargetId(null);
      setTargetHostile(false);
      setTargetIntent(TargetingIntent.Hostile);
    }
  }
  const isTargeting = promptType === "chooseBoardTargets";

  const arrowHostile = targetId ? targetHostile : promptHostile;
  const arrowIntent: TargetingIntent = targetId ? targetIntent : promptIntent;

  const lockTarget = useCallback(
    (id: string) => {
      if (!castingCardId) return;
      setTargetId(id);
      setTargetHostile(promptHostile);
      setTargetIntent(promptIntent);
    },
    [castingCardId, promptHostile, promptIntent],
  );

  const wrappedTargetCard = useCallback(
    (cardId: string | null) => {
      if (cardId) lockTarget(cardId);
      respond({ type: "boardTargets", chosen: cardId ? [{ kind: "card", id: cardId }] : [] });
    },
    [respond, lockTarget],
  );

  const wrappedTargetPlayer = useCallback(
    (playerId: string) => {
      lockTarget(playerId);
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

  const cancelTargeting = useCallback(() => {
    respond({ type: "cancel" });
  }, [respond]);

  return {
    castingCardId,
    isTargeting,
    targetId,
    arrowHostile,
    arrowIntent,
    showArrow: !!castingCardId && (isTargeting || !!targetId),
    wrappedTargetCard,
    wrappedTargetPlayer,
    wrappedTargetSpell,
    declineTargets,
    cancelTargeting,
  };
}
