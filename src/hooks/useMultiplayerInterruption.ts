import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { clearActiveGameSession } from "@/lib/activeGameSession";
import { getPlatform } from "@/platform";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import { DEFAULT_RECONNECT_TIMEOUT_S } from "@/types/server";

// When it's our own connection that dropped (relay restart/deploy included),
// give the full 120s the engine allows before auto-passing prompts, instead of
// the room's opponent-facing reconnect window. The post-restart rejoin loop
// shares this deadline.
export const SELF_RECONNECT_WINDOW_S = 120;

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
  const gamePlayers = useGameStore((s) => s.gameView?.players);

  // An eliminated player is a spectator: the game never needs them again, so
  // their absence is not an interruption. The room host is the exception —
  // when the host plays, their connection carries the engine, so their
  // disconnect matters even after elimination.
  const stillNeeded = (p: { username: string }) =>
    p.username === currentRoom?.host ||
    (gamePlayers?.find((gp) => gp.name === p.username)?.status ?? "playing") === "playing";
  const disconnectedNames = (currentRoom?.status === "InGame" ? currentRoom.players : [])
    .filter((p) => !p.is_bot && !p.connected && p.username !== username && stillNeeded(p))
    .map((p) => p.username);

  const selfDisconnected = reconnectPhase === "reconnecting";
  const waiting =
    isMultiplayer &&
    isGameActive &&
    !gameOver &&
    !gameOverPrompt &&
    (selfDisconnected || disconnectedNames.length > 0);
  const timeoutS = selfDisconnected
    ? SELF_RECONNECT_WINDOW_S
    : (currentRoom?.reconnect_timeout_s ?? DEFAULT_RECONNECT_TIMEOUT_S);

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
        if (selfDisconnected) {
          // Our own socket never came back — nothing left to wait for.
          clearActiveGameSession();
          toast.error("Game aborted — connection could not be restored.");
          void useGameStore.getState().endGame();
          return;
        }
        const game = useGameStore.getState();
        const server = useServerStore.getState();
        const room = server.currentRoom;
        const gone = (room?.status === "InGame" ? room.players : []).filter(
          (p) => !p.is_bot && !p.connected && p.username !== server.username,
        );
        if (game.isHost) {
          // We host the engine: the abandoned seats forfeit and the game
          // continues for everyone else (mirrors the self-hosted node).
          const platform = getPlatform();
          for (const seat of gone) {
            const slot = game.gameView?.players.find((gp) => gp.name === seat.username)?.id;
            if (slot) {
              void platform.game.sendDirective({
                playerSlot: slot,
                directive: { type: "concede" },
              });
            } else {
              console.warn(
                `[interruption] no game seat found for '${seat.username}' — not conceded`,
              );
            }
          }
          toast.info("A player did not reconnect in time — their seat conceded.");
          return;
        }
        if (room && gone.some((p) => p.username === room.host)) {
          // The engine host itself is gone: the game cannot continue.
          clearActiveGameSession();
          toast.error("Game aborted — the host did not reconnect in time.");
          void useGameStore.getState().endGame();
        }
        // Otherwise the engine host (WASM host tab or self-hosted node) will
        // concede the missing seat; the overlay clears when their status
        // flips in the next state update.
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [waiting, timeoutS, selfDisconnected]);

  return {
    waiting,
    reason: selfDisconnected ? "self" : "opponent",
    secondsLeft,
    disconnectedNames,
  };
}
