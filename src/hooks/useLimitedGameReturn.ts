import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { peek as peekGauntletMatch, clear as clearGauntletMatch } from "@/lib/gauntletReturn";
import { completeLimitedMatch, peekLimitedMatchReturn } from "@/game/limitedSession";
import { useLimitedStore } from "@/stores/useLimitedStore";

interface LimitedGameReturnInput {
  gameOver: boolean;
  winnerId: string | null;
  playerSlot: string | null;
  endGame: () => Promise<void>;
}

export function useLimitedGameReturn({
  gameOver,
  winnerId,
  playerSlot,
  endGame,
}: LimitedGameReturnInput) {
  const navigate = useNavigate();
  const pending = useRef(false);
  const completed = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const gauntlet = peekGauntletMatch();
  const multiplayer = peekLimitedMatchReturn();
  const destination = gauntlet ? `/gauntlet/${gauntlet.gauntletId}` : multiplayer?.route;
  const finish = useCallback(async () => {
    if (!gameOver || pending.current || completed.current) return;
    pending.current = true;
    setError(null);
    try {
      const match = peekGauntletMatch();
      if (match) {
        const store = useLimitedStore.getState();
        if (store.activeGauntlet?.gauntletId !== match.gauntletId) {
          await store.refreshGauntletState(match.gauntletId);
        }
        const state = useLimitedStore.getState().activeGauntlet;
        if (!state || state.gauntletId !== match.gauntletId)
          throw new Error("Could not restore the Limited session.");
        if (winnerId != null && state.wins + state.losses === match.totalGames) {
          const won = winnerId === playerSlot;
          const required = Math.ceil(match.bestOf / 2);
          const wins = match.wins + Number(won);
          const losses = match.losses + Number(!won);
          await store.recordGauntletOutcome(
            match.gauntletId,
            won,
            wins >= required || losses >= required,
            wins >= required,
          );
        }
        await endGame();
        await clearGauntletMatch();
        completed.current = true;
        navigate(`/gauntlet/${match.gauntletId}`);
      } else if (peekLimitedMatchReturn()) {
        const route = await completeLimitedMatch();
        if (!route) throw new Error("Could not return to the Limited table.");
        completed.current = true;
        navigate(route);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      pending.current = false;
    }
  }, [gameOver, winnerId, playerSlot, endGame, navigate]);
  useEffect(() => {
    void finish();
  }, [finish]);
  return { destination, error, retry: finish };
}
