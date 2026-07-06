import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGameStore } from "@/stores/useGameStore";
import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import { EngineChoiceModal } from "@/components/lobby/EngineChoiceModal";
import Game from "./Game";
import { getPlatform } from "@/platform";
import { isLiveEngineGameRouteState } from "@/game/engineGameLaunch";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import type { Deck } from "@/protocol/deck";
import type { EngineKind } from "@/types/server";

interface PendingAiStart {
  playerDeck: Deck;
  opponentDeck: Deck;
  formatId?: string;
  commanderName?: string;
}

export default function Play() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isGameActive, startGame, startMultiplayerGame, setMultiplayerState } = useGameStore();
  const multiplayerStarted = useRef(false);
  const gameWasActive = useRef(false);
  const [pendingAiStart, setPendingAiStart] = useState<PendingAiStart | null>(null);

  const routeState = location.state;
  const mpState = useMemo(
    () => (isLiveEngineGameRouteState(routeState) ? routeState : null),
    [routeState],
  );

  // Route state outlives the game; without this, ending a multiplayer game
  // falls back to the "Starting multiplayer game..." waiting screen.
  useEffect(() => {
    if (isGameActive) {
      gameWasActive.current = true;
      return;
    }
    if (gameWasActive.current && mpState?.multiplayer) {
      gameWasActive.current = false;
      multiplayerStarted.current = false;
      navigate("/lobby", { replace: true });
    }
  }, [isGameActive, mpState, navigate]);

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
    const engineIndex = parseInt(myPlayerSlot.replace("player-", ""), 10);
    if (Number.isNaN(engineIndex) || engineIndex < 0) return;
    const decksByPlayer = playerOrder.flatMap((playerName) => {
      const selected = (playerDecks ?? []).find((entry) => entry.username === playerName);
      return selected ? [selected.deck] : [];
    });
    const commanderNamesByPlayer = playerOrder.map((playerName) => {
      const selected = (playerDecks ?? []).find((entry) => entry.username === playerName);
      return selected?.commander_name ?? null;
    });
    if (decksByPlayer.length !== playerOrder.length) return;
    setMultiplayerState(true, isHost, myPlayerSlot);
    startMultiplayerGame(
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
    );
  }, [mpState, setMultiplayerState, startMultiplayerGame]);

  if (isGameActive) {
    return (
      <div className="h-full min-h-0 no-scrollbar">
        <Game exitTo="/play" />
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

  // Single-player: fighting-game style deck selector
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <img
        aria-hidden
        src="/manabrew_brewery_1.png"
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 size-full select-none object-cover opacity-50 blur-sm 2xl:blur-md [@media(min-width:1920px)]:blur-lg [@media(min-width:2560px)]:blur-xl"
      />
      <div className="relative h-full">
        <DeckVsSelector
          onStart={(playerDeck, opponentDeck, formatId, commanderName) => {
            if (getPlatform().type === "web") {
              setPendingAiStart({ playerDeck, opponentDeck, formatId, commanderName });
            } else {
              // Tauri (graalvm build) defaults to the bundled Forge engine; the
              // store falls back to Manabrew if the local Forge host can't start.
              startGame(playerDeck, formatId, commanderName, opponentDeck, "Forge");
            }
          }}
        />
      </div>
      {pendingAiStart && (
        <EngineChoiceModal
          hostedAvailable={isHostedEngineAvailable()}
          onChoose={(engine: EngineKind) => {
            const pending = pendingAiStart;
            setPendingAiStart(null);
            startGame(
              pending.playerDeck,
              pending.formatId,
              pending.commanderName,
              pending.opponentDeck,
              engine,
            );
          }}
          onCancel={() => setPendingAiStart(null)}
        />
      )}
    </div>
  );
}
