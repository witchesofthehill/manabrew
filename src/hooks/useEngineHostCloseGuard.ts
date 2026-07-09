import { useEffect } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";

/**
 * The engine lives with its owner — the WASM host's tab, or the desktop app
 * that spawned the embedded Forge node. If the owner closes mid-game the game
 * ends for everyone; that is by design, so the only job here is to make them
 * confirm it. Armed even when the owner is eliminated: spectating hosts still
 * carry the engine.
 */
export function useEngineHostCloseGuard() {
  const isHost = useGameStore((s) => s.isHost);
  const isMultiplayer = useGameStore((s) => s.isMultiplayer);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const gameOver = useGameStore((s) => s.gameView?.gameOver ?? false);
  const myPlayerSlot = useGameStore((s) => s.myPlayerSlot);
  const players = useGameStore((s) => s.gameView?.players);
  const hostingForgeRoom = useServerStore((s) => s.hostingForgeRoom);

  const othersStillPlaying = (players ?? []).some(
    (p) => p.id !== myPlayerSlot && p.status === "playing",
  );
  const guard =
    (isHost || hostingForgeRoom) &&
    isMultiplayer &&
    isGameActive &&
    !gameOver &&
    othersStillPlaying;

  useEffect(() => {
    if (!guard) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [guard]);
}
