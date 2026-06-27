import { useState, useCallback } from "react";
import { usePhaseStopStore, getNextStopPhase } from "@/stores/usePhaseStopStore";
import type { Prompt, PromptOutput } from "@/protocol";
import { passOutput } from "@/components/prompts/internal/playerActions";
import type { GameViewDto } from "@/protocol/game";

interface UsePromptEffectsOptions {
  currentPrompt: Prompt | null;
  gameView: GameViewDto | null;
  isWaitingForResponse: boolean;
  respond: (output: PromptOutput["output"]) => void;
  myPlayerId: string;
  turn: number;
}

export function usePromptEffects({
  currentPrompt,
  gameView,
  isWaitingForResponse,
  respond,
  myPlayerId,
  turn,
}: UsePromptEffectsOptions) {
  const pass = useCallback(
    (untilPhase: string | null) => {
      const out = passOutput(currentPrompt, untilPhase);
      if (out) respond(out);
    },
    [currentPrompt, respond],
  );
  const unifiedPass = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;

    const gv = gameView;
    const hasStack = (gv.stack?.length ?? 0) > 0;

    if (hasStack) {
      pass(null);
      return;
    }

    const isMyTurn = gv.activePlayerId === myPlayerId;
    const store = usePhaseStopStore.getState();
    const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);

    const nextStop = getNextStopPhase(gv.step, stops);

    usePhaseStopStore.getState().setPassUntil(nextStop, turn);

    pass(nextStop);
  }, [currentPrompt, gameView, isWaitingForResponse, pass, myPlayerId, turn]);

  function activatePassUntilEot() {
    unifiedPass();
  }

  const [spellStackModalOpen, setSpellStackModalOpen] = useState(false);

  return {
    unifiedPass,
    activatePassUntilEot,
    spellStackModalOpen,
    setSpellStackModalOpen,
  };
}
