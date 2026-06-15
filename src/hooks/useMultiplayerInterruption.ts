import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { clearActiveGameSession } from "@/lib/activeGameSession";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import { DEFAULT_RECONNECT_TIMEOUT_S } from "@/types/server";

export interface MultiplayerInterruption {
  waiting: boolean;
  reason: "self" | "opponent";
  secondsLeft: number | null;
  disconnectedNames: string[];
}

export function useMultiplayerInterruption(): MultiplayerInterruption {
  const isMultiplayer = useGameStore((s) => s.isMultiplayer);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const gameOver = useGameStore((s) => s.gameView?.gameOver ?? false);
  const gameOverPrompt = useGameStore((s) => s.currentPrompt?.input.type === "gameOver");
  const reconnectPhase = useServerStore((s) => s.reconnect.phase);
  const currentRoom = useServerStore((s) => s.currentRoom);
  const username = useServerStore((s) => s.username);

  const disconnectedNames = (currentRoom?.status === "InGame" ? currentRoom.players : [])
    .filter((p) => !p.is_bot && !p.connected && p.username !== username)
    .map((p) => p.username);

  const selfDisconnected = reconnectPhase === "reconnecting";
  const waiting =
    isMultiplayer &&
    isGameActive &&
    !gameOver &&
    !gameOverPrompt &&
    (selfDisconnected || disconnectedNames.length > 0);
  const timeoutS = currentRoom?.reconnect_timeout_s ?? DEFAULT_RECONNECT_TIMEOUT_S;

  const deadlineRef = useRef<number | null>(null);
  const expiredRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!waiting) {
      deadlineRef.current = null;
      expiredRef.current = false;
      setSecondsLeft(null);
      return;
    }
    deadlineRef.current ??= Date.now() + timeoutS * 1000;
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        clearActiveGameSession();
        toast.error("Game aborted — a player did not reconnect in time.");
        void useGameStore.getState().endGame();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [waiting, timeoutS]);

  return {
    waiting,
    reason: selfDisconnected ? "self" : "opponent",
    secondsLeft,
    disconnectedNames,
  };
}
