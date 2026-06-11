import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import { buildEngineGameRouteState } from "@/game/engineGameLaunch";
import {
  activeGameSessionAtPageLoad,
  clearActiveGameSession,
  peekActiveGameSession,
} from "@/lib/activeGameSession";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";

const NO_GAME_FOUND_AFTER_MS = 5000;

/**
 * Resumes a multiplayer engine game after a page reload. Inert unless an
 * active-game marker was present when the page loaded.
 */
export function useGameSessionResume() {
  const navigate = useNavigate();
  const connected = useServerStore((s) => s.connected);
  const currentRoom = useServerStore((s) => s.currentRoom);
  const username = useServerStore((s) => s.username);
  const gameStarted = useServerStore((s) => s.gameStarted);
  const session = activeGameSessionAtPageLoad();
  const settled = useRef(false);
  const resyncRequested = useRef(false);

  useEffect(() => {
    if (!session) return;
    const server = useServerStore.getState();
    if (server.connected || server.connecting) return;
    const prefs = usePreferencesStore.getState();
    if (!prefs.serverUsername) {
      clearActiveGameSession();
      return;
    }
    void server.connect(
      prefs.serverHost,
      prefs.serverPort,
      prefs.serverUsername,
      prefs.serverPassword,
    );
  }, [session]);

  useEffect(() => {
    if (!session || settled.current || !connected || !currentRoom) return;
    if (useGameStore.getState().isGameActive) return;
    if (currentRoom.status !== "InGame") return;
    const me = username ?? session.username;
    if (!currentRoom.players.some((p) => p.username === me)) return;
    if (session.isHost) {
      settled.current = true;
      clearActiveGameSession();
      void useServerStore.getState().endGame();
      toast.error("Your game could not be resumed — the host left mid-game.");
      navigate("/lobby", { replace: true });
      return;
    }
    if (resyncRequested.current) return;
    resyncRequested.current = true;
    void getPlatform().server?.requestResync();
  }, [session, connected, currentRoom, username, navigate]);

  useEffect(() => {
    if (!session || settled.current || !gameStarted) return;
    if (useGameStore.getState().isGameActive) {
      useServerStore.setState({ gameStarted: false });
      return;
    }
    if (session.isHost) return;
    const server = useServerStore.getState();
    const launch = buildEngineGameRouteState(
      server.username,
      server.currentRoom,
      server.playerOrder,
      server.playerDecks,
      server.startingLife,
    );
    useServerStore.setState({ gameStarted: false });
    settled.current = true;
    if (launch.error) {
      clearActiveGameSession();
      toast.error(launch.error);
      navigate("/lobby", { replace: true });
      return;
    }
    navigate("/play", { state: launch.state });
  }, [session, gameStarted, navigate]);

  useEffect(() => {
    if (!session || settled.current || !connected) return;
    const timer = setTimeout(() => {
      if (settled.current || !peekActiveGameSession()) return;
      if (useGameStore.getState().isGameActive) return;
      const server = useServerStore.getState();
      const me = server.username ?? session.username;
      const inGame =
        server.currentRoom?.status === "InGame" &&
        server.currentRoom.players.some((p) => p.username === me);
      if (inGame) return;
      settled.current = true;
      clearActiveGameSession();
      toast.info("Your previous game has ended.");
      navigate("/lobby", { replace: true });
    }, NO_GAME_FOUND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [session, connected, navigate]);
}
