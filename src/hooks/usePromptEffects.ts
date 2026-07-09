import { useState, useCallback } from "react";
import { usePhaseStopStore, getNextStop } from "@/stores/usePhaseStopStore";
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
    (until: PassUntil | null) => {
      const out = passOutput(currentPrompt, until);
      if (out) respond(out);
    },
    [currentPrompt, respond],
  );
  const unifiedPass = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;

    const gv = gameView;
    if ((gv.stack?.length ?? 0) > 0) {
      pass(null);
      return;
    }

    const store = usePhaseStopStore.getState();
    const nextStop = getNextStop(
      gv.players.filter((p) => p.status === "playing").map((p) => p.id),
      gv.activePlayerId,
      gv.step,
      myPlayerId,
      store.selfStops,
      store.getOpponentStops,
    );

    pass(nextStop);
  }, [currentPrompt, gameView, isWaitingForResponse, pass, myPlayerId]);

  const [spellStackModalOpen, setSpellStackModalOpen] = useState(false);

  return {
    unifiedPass,
    spellStackModalOpen,
    setSpellStackModalOpen,
  };
}
