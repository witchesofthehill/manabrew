import { useCallback } from "react";
import { usePhaseStopStore, getEndTurnStop, getPassStop } from "@/stores/usePhaseStopStore";
import type { Prompt, PromptOutput, PassUntil } from "@/protocol";
import { passOutput } from "@/components/prompts/internal/playerActions";
import type { GameViewDto } from "@/protocol/game";

interface UsePromptEffectsOptions {
  currentPrompt: Prompt | null;
  gameView: GameViewDto | null;
  isWaitingForResponse: boolean;
  respond: (output: PromptOutput["output"]) => void;
  myPlayerId: string;
}

export function usePromptEffects({
  currentPrompt,
  gameView,
  isWaitingForResponse,
  respond,
  myPlayerId,
}: UsePromptEffectsOptions) {
  const pass = useCallback(
    (until: PassUntil | null, exhaustStack = false) => {
      const out = passOutput(currentPrompt, until, exhaustStack);
      if (out) respond(out);
    },
    [currentPrompt, respond],
  );
  const unifiedPass = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;

    if ((gameView.stack?.length ?? 0) > 0) {
      pass(null);
      return;
    }

    const nextStop = getPassStop(gameView, myPlayerId);

    pass(nextStop ? { ...nextStop, throughCombat: false } : null);
  }, [currentPrompt, gameView, isWaitingForResponse, pass, myPlayerId]);

  const unifiedPassEndTurn = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;
    if ((gameView.stack?.length ?? 0) > 0) {
      pass(null, true);
      return;
    }

    const store = usePhaseStopStore.getState();
    const target = getEndTurnStop(
      gameView.players.filter((p) => p.status === "playing").map((p) => p.id),
      gameView.activePlayerId,
      myPlayerId,
      store.selfStops,
      store.getOpponentStops,
    );

    pass(target ? { ...target, throughCombat: true } : null);
  }, [currentPrompt, gameView, isWaitingForResponse, pass, myPlayerId]);

  return {
    unifiedPass,
    unifiedPassEndTurn,
  };
}
