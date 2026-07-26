import { useEffect, useMemo, useRef } from "react";
import { matchPath, Navigate, useLocation, useNavigate } from "react-router-dom";
import { cancelPendingGameLaunch, useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import { OfflinePlaySetup } from "@/components/play/OfflinePlaySetup";
import { OfflinePlayShell } from "@/components/play/OfflinePlayShell";
import { PlayHome } from "@/components/play/PlayHome";
import { DeckPlayActions } from "@/components/play/DeckPlayActions";
import Game from "./Game";
import { isLiveEngineGameRouteState } from "@/game/engineGameLaunch";
import { ROUTES } from "@/lib/constants";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import Limited from "./Limited";

export default function Play() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isGameActive, gameView, startGame, startMultiplayerGame, setMultiplayerState } =
    useGameStore();
  const multiplayerStarted = useRef(false);
  const gameWasActive = useRef(false);
  const pathname =
    location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;

  const routeState = location.state;
  const deckRoute = matchPath(`${ROUTES.PLAY_DECK}/:localSavedDeckId`, pathname);
  const preSelectedDeckId =
    routeState &&
    typeof routeState === "object" &&
    "preSelectedDeckId" in routeState &&
    typeof routeState.preSelectedDeckId === "string"
      ? routeState.preSelectedDeckId
      : undefined;
  const preSelectedHubDeckId =
    routeState &&
    typeof routeState === "object" &&
    "preSelectedHubDeckId" in routeState &&
    typeof routeState.preSelectedHubDeckId === "string"
      ? routeState.preSelectedHubDeckId
      : undefined;
  const mpState = useMemo(
    () => (isLiveEngineGameRouteState(routeState) ? routeState : null),
    [routeState],
  );

  useEffect(() => cancelPendingGameLaunch, []);

  // Route state outlives the game; without this, ending a multiplayer game
  // falls back to the "Starting multiplayer game..." waiting screen.
  useEffect(() => {
    if (isGameActive && gameView) {
      gameWasActive.current = true;
      return;
    }
    if (isGameActive) return;
    if (gameWasActive.current && mpState?.multiplayer) {
      gameWasActive.current = false;
      multiplayerStarted.current = false;
      navigate(ROUTES.LOBBY, {
        replace: true,
        state: { topBarBackTo: ROUTES.PLAY },
      });
      return;
    }
    if (mpState?.multiplayer && multiplayerStarted.current) {
      multiplayerStarted.current = false;
      const server = useServerStore.getState();
      const cleanup = mpState.isHost ? server.endGame().catch(() => undefined) : server.leaveRoom();
      void cleanup.finally(() => {
        navigate(ROUTES.LOBBY, {
          replace: true,
          state: { topBarBackTo: ROUTES.PLAY },
        });
      });
      return;
    }
    if (gameWasActive.current) {
      gameWasActive.current = false;
      navigate(ROUTES.PLAY, { replace: true });
    }
  }, [isGameActive, gameView, mpState, navigate]);

  // Handle multiplayer game start from lobby navigation
  useEffect(() => {
    if (!mpState?.multiplayer || multiplayerStarted.current) return;
    multiplayerStarted.current = true;

    const {
      playerOrder,
      playerDecks,
      isHost,
      startingLife,
      myPlayerSlot,
      engine,
      format,
      hostPlayerSlot,
      botPlayerSlots,
    } = mpState;
    const recoverFromFailedStart = async () => {
      if (!multiplayerStarted.current) return;
      multiplayerStarted.current = false;
      const server = useServerStore.getState();
      if (isHost) await server.endGame().catch(() => undefined);
      else await server.leaveRoom();
      navigate(ROUTES.LOBBY, {
        replace: true,
        state: { topBarBackTo: ROUTES.PLAY },
      });
    };
    const engineIndex = parseInt(myPlayerSlot.replace("player-", ""), 10);
    if (Number.isNaN(engineIndex) || engineIndex < 0) {
      void recoverFromFailedStart();
      return;
    }
    const decksByPlayer = playerOrder.flatMap((playerName) => {
      const selected = (playerDecks ?? []).find((entry) => entry.username === playerName);
      return selected ? [selected.deck] : [];
    });
    const commanderNamesByPlayer = playerOrder.map((playerName) => {
      const selected = (playerDecks ?? []).find((entry) => entry.username === playerName);
      return selected?.commander_name ?? null;
    });
    if (decksByPlayer.length !== playerOrder.length) {
      void recoverFromFailedStart();
      return;
    }
    setMultiplayerState(true, isHost, myPlayerSlot);
    void startMultiplayerGame(
      playerOrder,
      decksByPlayer,
      commanderNamesByPlayer,
      engineIndex,
      isHost,
      startingLife,
      engine,
      format,
      hostPlayerSlot,
      botPlayerSlots,
    ).then((started) => {
      if (!started) void recoverFromFailedStart();
    });
  }, [mpState, navigate, setMultiplayerState, startMultiplayerGame]);

  if (isGameActive) {
    return (
      <div className="h-full min-h-0 no-scrollbar">
        <Game exitTo={ROUTES.PLAY} />
      </div>
    );
  }

  // Multiplayer: show waiting state while game starts
  if (mpState?.multiplayer) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Starting multiplayer game...</h1>
          <p className="text-muted-foreground">Waiting for game synchronization...</p>
        </div>
      </div>
    );
  }

  if (pathname === ROUTES.PLAY_OFFLINE) {
    return <Navigate to={ROUTES.PLAY_OFFLINE_CONSTRUCTED} replace />;
  }

  if (deckRoute?.params.localSavedDeckId) {
    return <DeckPlayActions savedDeckId={deckRoute.params.localSavedDeckId} />;
  }

  if (pathname === ROUTES.PLAY) {
    return <PlayHome />;
  }

  if (pathname === ROUTES.PLAY_OFFLINE_LIMITED) {
    return (
      <OfflinePlayShell>
        <Limited />
      </OfflinePlayShell>
    );
  }

  if (pathname !== ROUTES.PLAY_OFFLINE_CONSTRUCTED) {
    return <Navigate to={ROUTES.PLAY} replace />;
  }

  return (
    <OfflinePlayShell>
      <OfflinePlaySetup
        preSelectedDeckId={preSelectedDeckId}
        preSelectedHubDeckId={preSelectedHubDeckId}
        onStart={(playerDeck, opponentDeck, formatId, commanderName) =>
          startGame(playerDeck, formatId, commanderName, [opponentDeck], resolveOfflineEngine())
        }
      />
    </OfflinePlayShell>
  );
}
