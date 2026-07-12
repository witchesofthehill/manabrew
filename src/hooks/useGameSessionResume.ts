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
import { peekSpawnedBots } from "@/lib/spawnedBots";
import { isPromptLoggingEnabled } from "@/lib/debugPrompts";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";

const NO_GAME_FOUND_AFTER_MS = 5000;

const rlog = (...args: unknown[]) => {
  if (isPromptLoggingEnabled()) console.log("[resume]", ...args);
};

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
  const respawnedBots = useRef(new Set<string>());

  useEffect(() => {
    rlog("mount: session marker =", session);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const server = useServerStore.getState();
    if (server.connected || server.connecting) {
      rlog("connect skipped — already", server.connected ? "connected" : "connecting");
      return;
    }
    const prefs = usePreferencesStore.getState();
    if (!prefs.serverUsername) {
      rlog("connect aborted — no persisted serverUsername; clearing marker");
      clearActiveGameSession();
      return;
    }
    rlog(
      `connecting as '${prefs.serverUsername}' to ${prefs.serverHost}:${prefs.serverPort}` +
        ` (marker.username='${session.username}', roomId='${session.roomId}', isHost=${session.isHost})`,
    );
    void server.connect(
      prefs.serverHost,
      prefs.serverPort,
      prefs.serverUsername,
      prefs.serverPassword,
    );
  }, [session]);

  useEffect(() => {
    if (!session) return;
    rlog(
      `state: connected=${connected} username='${username}' gameActive=${useGameStore.getState().isGameActive}` +
        ` room=${currentRoom ? `{id:'${currentRoom.room_id}', status:'${currentRoom.status}', host:'${currentRoom.host}', players:[${currentRoom.players.map((p) => `${p.username}${p.is_bot ? "(bot)" : ""}:${p.connected ? "on" : "off"}`).join(", ")}]}` : "null"}`,
    );
  }, [session, connected, currentRoom, username]);

  useEffect(() => {
    if (!session || settled.current || !connected || !currentRoom) return;
    if (useGameStore.getState().isGameActive) return;
    if (currentRoom.status !== "InGame") {
      rlog(`resync-effect: room status is '${currentRoom.status}', waiting for InGame`);
      return;
    }
    const me = username ?? session.username;
    if (!currentRoom.players.some((p) => p.username === me)) {
      rlog(
        `resync-effect: '${me}' NOT among room players [${currentRoom.players.map((p) => p.username).join(", ")}] — membership check failed`,
      );
      return;
    }
    if (session.isHost) {
      rlog("resync-effect: session.isHost=true → force-ending game and kicking to lobby");
      settled.current = true;
      clearActiveGameSession();
      useServerStore.setState({ gameId: session.gameId });
      void useServerStore.getState().endGame();
      toast.error("Your game could not be resumed — the host left mid-game.");
      navigate("/lobby", { replace: true });
      return;
    }
    if (resyncRequested.current) return;
    rlog(`resync-effect: reseated as '${me}', requesting resync`);
    resyncRequested.current = true;
    void getPlatform().server?.requestResync();
  }, [session, connected, currentRoom, username, navigate]);

  useEffect(() => {
    if (!session || session.isHost) return;
    if (!connected || !currentRoom || currentRoom.status !== "InGame") return;
    if (currentRoom.room_id !== session.roomId) return;
    const server = getPlatform().server;
    if (!server) return;
    const persisted = peekSpawnedBots(currentRoom.room_id);
    const bots = persisted.filter(
      (bot) =>
        !respawnedBots.current.has(bot.username) &&
        currentRoom.players.some((p) => p.is_bot && p.username === bot.username && !p.connected),
    );
    rlog(
      `bot-respawn-effect: persisted=[${persisted.map((b) => b.username).join(", ")}]` +
        ` → respawning=[${bots.map((b) => b.username).join(", ")}]`,
    );
    for (const bot of bots) {
      respawnedBots.current.add(bot.username);
      rlog(`bot-respawn-effect: spawning '${bot.username}'`);
      void server.spawnAiBot(bot).catch((error) => {
        console.warn(`[resume] failed to respawn bot '${bot.username}':`, error);
      });
    }
  }, [session, connected, currentRoom]);

  useEffect(() => {
    if (!session || settled.current || !gameStarted) return;
    if (useGameStore.getState().isGameActive) {
      rlog("gameStarted-effect: game already active, clearing gameStarted flag");
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
      rlog(`gameStarted-effect: launch build failed — ${launch.error}; kicking to lobby`);
      clearActiveGameSession();
      toast.error(launch.error);
      navigate("/lobby", { replace: true });
      return;
    }
    rlog("gameStarted-effect: navigating to /play");
    navigate("/play", { state: launch.state });
  }, [session, gameStarted, navigate]);

  useEffect(() => {
    if (!session || settled.current || !connected) return;
    rlog(`fallback-timer: armed, will check in ${NO_GAME_FOUND_AFTER_MS}ms`);
    const timer = setTimeout(() => {
      if (settled.current || !peekActiveGameSession()) return;
      if (useGameStore.getState().isGameActive) {
        rlog("fallback-timer: fired but game is active — no kick");
        return;
      }
      const server = useServerStore.getState();
      const me = server.username ?? session.username;
      const inGame =
        server.currentRoom?.status === "InGame" &&
        server.currentRoom.players.some((p) => p.username === me);
      if (inGame) {
        rlog("fallback-timer: fired but still in InGame room — no kick");
        return;
      }
      rlog(
        `fallback-timer: KICKING — gameActive=false, inGame=false` +
          ` (me='${me}', room=${server.currentRoom ? `{status:'${server.currentRoom.status}', players:[${server.currentRoom.players.map((p) => p.username).join(", ")}]}` : "null"})`,
      );
      settled.current = true;
      clearActiveGameSession();
      toast.info("Your previous game has ended.");
      navigate("/lobby", { replace: true });
    }, NO_GAME_FOUND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [session, connected, navigate]);
}
