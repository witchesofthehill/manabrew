import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { buildEngineGameRouteState } from "@/game/engineGameLaunch";
import { playSound } from "@/lib/soundRuntime";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";

export function useMultiplayerRematch(enabled: boolean) {
  const navigate = useNavigate();
  const room = useServerStore((state) => state.currentRoom);
  const gameId = useServerStore((state) => state.gameId);
  const username = useServerStore((state) => state.username);
  const originalGameId = useRef(gameId);
  const finishedRoomSeen = useRef(false);
  const transitioning = useRef(false);
  const readyPlayers = useRef<Set<string>>(new Set());
  useEffect(() => {
    const rematch = enabled && room?.status === "Finished" ? room.rematch : null;
    const ready = new Set(
      (rematch && !rematch.cancelled ? rematch.players : [])
        .filter((player) => player.intent === "Ready" && player.username !== username)
        .map((player) => player.username),
    );
    const joined = [...ready].some((name) => !readyPlayers.current.has(name));
    readyPlayers.current = ready;
    if (joined) playSound("roomInvite");
  }, [enabled, room, username]);
  useEffect(() => {
    if (!enabled || !room || transitioning.current) return;
    if (room.status === "Finished") finishedRoomSeen.current = true;
    const nextGame = room.status === "InGame" && gameId && gameId !== originalGameId.current;
    const returnToTable = finishedRoomSeen.current && room.status === "Lobby";
    if (!nextGame && !returnToTable) return;
    transitioning.current = true;
    const server = useServerStore.getState();
    const launch = nextGame
      ? buildEngineGameRouteState(
          server.username,
          room,
          server.playerOrder,
          server.playerDecks,
          server.startingLife,
        )
      : null;
    void (async () => {
      await useGameStore.getState().endGame({ preserveRoom: true });
      if (useServerStore.getState().currentRoom?.room_id !== room.room_id) {
        useGameStore.setState({ isRestartingGame: false });
        navigate("/play", { replace: true });
        return;
      }
      if (launch?.state) {
        navigate("/play", { replace: true, state: launch.state });
      } else {
        if (launch?.error) toast.error(launch.error);
        useServerStore.setState({ gameStarted: false });
        useGameStore.setState({ isRestartingGame: false });
        navigate("/lobby", { replace: true });
      }
    })().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not open the next game.");
      useGameStore.setState({ isRestartingGame: false });
      useServerStore.setState({ gameStarted: false });
      navigate("/lobby", { replace: true });
    });
  }, [enabled, gameId, navigate, room]);
}
