import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGameStore } from "@/stores/useGameStore";
import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import type { GameViewDto } from "@/protocol/game";
import Game from "./Game";

interface TabletopLocationState {
  manualTabletop: true;
  playerOrder: string[];
  isHost: boolean;
  startingLife: number;
  myPlayerSlot: string;
  initialGameView?: GameViewDto;
}

export default function Tabletop() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    isGameActive,
    startGame,
    startManualTabletopGame,
    startManualRoomClient,
    setMultiplayerState,
  } = useGameStore();
  const started = useRef(false);
  const gameWasActive = useRef(false);

  const routeState = location.state as TabletopLocationState | null;
  const tabletopState = useMemo(
    () => (routeState && "manualTabletop" in routeState ? routeState : null),
    [routeState],
  );

  // Handle multiplayer tabletop join from lobby
  useEffect(() => {
    if (!tabletopState?.manualTabletop || started.current) return;
    started.current = true;
    if (tabletopState.isHost) {
      setMultiplayerState(true, true, tabletopState.myPlayerSlot);
      return;
    }
    void startManualRoomClient(tabletopState.myPlayerSlot, tabletopState.initialGameView);
  }, [setMultiplayerState, startManualRoomClient, tabletopState]);

  // Route state outlives the game; without this, ending a tabletop game
  // falls back to the "Starting tabletop room..." waiting screen.
  useEffect(() => {
    if (isGameActive) {
      gameWasActive.current = true;
      return;
    }
    if (gameWasActive.current && tabletopState?.manualTabletop) {
      gameWasActive.current = false;
      started.current = false;
      navigate("/lobby", { replace: true });
    }
  }, [isGameActive, tabletopState, navigate]);

  if (isGameActive) {
    return (
      <div className="h-full min-h-0 no-scrollbar">
        <Game exitTo="/tabletop" />
      </div>
    );
  }

  if (tabletopState?.manualTabletop) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Starting tabletop room...</h1>
          <p className="text-muted-foreground">Waiting for game synchronization...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      <DeckVsSelector
        onStart={(playerDeck, opponentDeck, formatId, commanderName) => {
          startGame(playerDeck, formatId, commanderName, opponentDeck);
        }}
        onStartTabletop={(deck, formatId, commanderName) => {
          void startManualTabletopGame(deck, formatId, commanderName);
        }}
      />
    </div>
  );
}
