import { TablesList } from "@/components/lobby/TablesList";
import { UserList, type ConnectionState } from "@/components/lobby/UserList";
import { CreateRoomDialog } from "@/components/lobby/CreateRoomDialog";
import { CreateGameDialog } from "@/components/lobby/CreateGameDialog";
import { ReconnectBanner } from "@/components/lobby/ReconnectBanner";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useServerStore } from "@/stores/useServerStore";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { useGameStore } from "@/stores/useGameStore";
import { startDraftAsHost, type DraftHostParticipant } from "@/game/draftHost";
import { buildEngineGameRouteState } from "@/game/engineGameLaunch";
import { startMpSealed } from "@/game/sealedStart";
import { getFormat } from "@/lib/formats";
import { getPlatform } from "@/platform";
import { START_GAME_FAILURE_CODES } from "@/types/server";
import type {
  DraftConfig,
  GameFormat,
  GameStartedPayload,
  RoomMessagePayload,
  ServerErrorCode,
  ServerErrorPayload,
} from "@/types/server";
import type { GameViewDto } from "@/protocol/game";
import type { Deck } from "@/protocol/deck";
import {
  MANUAL_TABLETOP_RELAY_PROTOCOL,
  createRoomRelayEnvelope,
  isRoomRelayProtocol,
} from "@/game";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Settings, RefreshCw, Users, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { DESKTOP_QUERY } from "@/components/layout/AppShell";

const START_GAME_ACK_TIMEOUT_MS = 5000;

function awaitGameStartedAck(roomId: string): Promise<void> {
  const events = getPlatform().events;
  return new Promise((resolve, reject) => {
    const unsubs: Array<() => void> = [];
    const cleanup = () => unsubs.forEach((fn) => fn());
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("server did not acknowledge StartGame in time"));
    }, START_GAME_ACK_TIMEOUT_MS);
    unsubs.push(
      events.on<GameStartedPayload>("server:game_started", (payload) => {
        if (payload.room_id !== roomId) return;
        clearTimeout(timeout);
        cleanup();
        resolve();
      }),
    );
    unsubs.push(
      events.on<ServerErrorPayload>("server:error", (payload) => {
        if (!START_GAME_FAILURE_CODES.has(payload.code as ServerErrorCode)) return;
        clearTimeout(timeout);
        cleanup();
        reject(new Error(payload.message || payload.code));
      }),
    );
  });
}

interface ManualTabletopLaunchPayload {
  type: "launch";
  roomId: string;
  hostPlayer: string;
  playerOrder: string[];
  startingLife: number;
  initialGameView: GameViewDto;
}

interface SelectedAiDeck {
  name: string;
  deck: Deck;
  commanderName?: string;
}

function isManualTabletopLaunchPayload(value: unknown): value is ManualTabletopLaunchPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ManualTabletopLaunchPayload>;
  return (
    candidate.type === "launch" &&
    typeof candidate.roomId === "string" &&
    typeof candidate.hostPlayer === "string" &&
    Array.isArray(candidate.playerOrder) &&
    typeof candidate.startingLife === "number" &&
    !!candidate.initialGameView
  );
}

export default function Lobby() {
  const navigate = useNavigate();
  const {
    connected,
    connecting,
    error,
    username,
    playerId,
    rooms,
    currentRoom,
    roomPassword,
    players,
    gameStarted,
    playerOrder,
    playerDecks,
    startingLife,
    connect,
    listRooms,
    listPlayers,
    joinRoom,
    leaveRoom,
    setDeckSelection,
    setReady,
    setFormat,
    setMaxPlayers,
    startGame,
  } = useServerStore();
  const prefs = usePreferencesStore();
  const myUsername = username ?? prefs.serverUsername ?? null;
  const connectionState: ConnectionState = connected
    ? "connected"
    : connecting
      ? "connecting"
      : "disconnected";
  const { currentDeck, savedDecks } = useDeckStore();
  const { startManualTabletopGame, startManualRoomHost, endGame } = useGameStore();
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [deckDialogOpen, setDeckDialogOpen] = useState(false);
  const [aiDeckDialogOpen, setAiDeckDialogOpen] = useState(false);
  const [refreshingLobby, setRefreshingLobby] = useState(false);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [playersCollapsed, setPlayersCollapsed] = useState(false);
  const [playersDrawerOpen, setPlayersDrawerOpen] = useState(false);
  const [mySpawnedBots, setMySpawnedBots] = useState<string[]>([]);
  const [botDeckTarget, setBotDeckTarget] = useState<string | null>(null);
  const [startingLimited, setStartingLimited] = useState(false);
  const [roomPasswords, setRoomPasswords] = useState<Record<string, string>>({});

  const draftMode = useMultiplayerDraftStore((s) => s.mode);
  const draftSessionId = useMultiplayerDraftStore((s) => s.sessionId);
  useEffect(() => {
    if (draftMode === "drafting" && draftSessionId) {
      navigate("/draft/multiplayer");
    }
  }, [draftMode, draftSessionId, navigate]);

  const sealedMode = useMultiplayerSealedStore((s) => s.mode);
  useEffect(() => {
    if (sealedMode === "building") {
      navigate("/sealed/multiplayer");
    }
  }, [sealedMode, navigate]);

  useEffect(() => {
    if (!connected && !connecting && !error && prefs.serverUsername) {
      connect(prefs.serverHost, prefs.serverPort, prefs.serverUsername, prefs.serverPassword);
    }
  }, [
    connect,
    connected,
    connecting,
    error,
    prefs.serverHost,
    prefs.serverPort,
    prefs.serverUsername,
    prefs.serverPassword,
  ]);

  // Poll lobby data every 5s while connected
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => {
      listRooms();
      listPlayers();
    }, 5000);
    return () => clearInterval(id);
  }, [connected, listRooms, listPlayers]);

  useEffect(() => {
    if (!gameStarted || playerOrder.length === 0) return;
    if (currentRoom?.format === "Draft") {
      useServerStore.setState({ gameStarted: false });
      return;
    }
    if (currentRoom?.format === "Sealed") {
      useServerStore.setState({ gameStarted: false });
      if (currentRoom.status === "InGame" && currentRoom.sealed_config && username) {
        const room = currentRoom;
        const amHost = room.host === username;
        void startMpSealed({ room, username }).catch((err) => {
          toast.error(`Failed to open sealed pool: ${String(err)}`);
          if (amHost) {
            void useServerStore
              .getState()
              .endGame()
              .catch(() => {});
          }
        });
      }
      return;
    }
    const launch = buildEngineGameRouteState(
      username,
      currentRoom,
      playerOrder,
      playerDecks,
      startingLife,
    );
    if (launch.error) {
      toast.error(launch.error);
      return;
    }
    useServerStore.setState({ gameStarted: false });
    navigate("/play", { state: launch.state });
  }, [gameStarted, currentRoom, navigate, playerDecks, playerOrder, startingLife, username]);

  useEffect(() => {
    const unsubscribe = getPlatform().events.on<RoomMessagePayload>(
      "server:room_message",
      (payload) => {
        const message = payload.state;
        if (!isRoomRelayProtocol(message, MANUAL_TABLETOP_RELAY_PROTOCOL)) return;
        const launch = message.payload;
        if (!isManualTabletopLaunchPayload(launch)) return;
        if (!currentRoom || launch.roomId !== currentRoom.room_id) return;
        const myIndex = launch.playerOrder.indexOf(username ?? "");
        if (myIndex < 0) {
          toast.error("Could not determine your player slot for tabletop.");
          return;
        }
        useServerStore.setState({ gameStarted: false });
        navigate("/tabletop", {
          state: {
            manualTabletop: true,
            playerOrder: launch.playerOrder,
            isHost: launch.hostPlayer === username,
            startingLife: launch.startingLife,
            myPlayerSlot: `player-${myIndex}`,
            initialGameView: launch.initialGameView,
          },
        });
      },
    );
    return unsubscribe;
  }, [currentRoom, navigate, username]);

  async function refreshLobbyData() {
    if (!connected || refreshingLobby) return;
    setRefreshingLobby(true);
    try {
      await Promise.all([listRooms(), listPlayers()]);
    } finally {
      setRefreshingLobby(false);
    }
  }

  async function handleJoinRoom(roomId: string, password?: string, format?: GameFormat) {
    await joinRoom(roomId, password);
    if (password) {
      setRoomPasswords((prev) => ({ ...prev, [roomId]: password }));
    }
    if (format) await setFormat(format);
  }

  async function handleDeckSelection(deckName: string, deck: Deck, commanderName?: string) {
    try {
      await setDeckSelection(deckName, deck, commanderName);
      const controllerName =
        currentRoom?.players.find((player) => !player.is_bot)?.username ??
        currentRoom?.players[0]?.username;
      if (username && username === controllerName) {
        await setReady(true);
      }
    } catch (error) {
      toast.error(`Failed to set deck: ${String(error)}`);
    }
  }

  function findLocalDeckByName(deckName: string | undefined) {
    if (!deckName) return currentDeck.cards.length > 0 ? currentDeck : undefined;
    if (currentDeck.name === deckName) return currentDeck;
    return savedDecks.find((saved) => saved.deck.name === deckName)?.deck;
  }

  function tabletopPlayerOrder(room: NonNullable<typeof currentRoom>) {
    // Manual tabletop has no server-side GameStarted order, so every peer
    // derives seats from this deterministic room snapshot: host first, then
    // stable username ordering for the remaining players.
    return [...room.players]
      .sort((a, b) => {
        if (a.username === room.host) return -1;
        if (b.username === room.host) return 1;
        return a.username.localeCompare(b.username);
      })
      .map((player) => player.username);
  }

  async function handleStartTabletop() {
    const room = currentRoom;
    if (!room || !username) return;
    if (!getPlatform().server) {
      toast.error("Tabletop multiplayer requires a server connection.");
      return;
    }

    const playerOrder = tabletopPlayerOrder(room);
    const myIndex = playerOrder.indexOf(username);
    if (myIndex < 0) {
      toast.error("Could not determine your player slot for tabletop.");
      return;
    }

    const myDeckName = room.players.find(
      (player) => player.username === username,
    )?.selected_deck_name;
    const deck = findLocalDeckByName(myDeckName);
    if (!deck) {
      toast.error("Select one of your local decks before starting tabletop.");
      return;
    }

    try {
      await startManualTabletopGame(deck);
      const initialGameView = useGameStore.getState().gameView;
      if (!initialGameView) throw new Error("Manual tabletop state did not initialize.");
      const startingLife =
        getFormat(deck.format ?? room.format.toLowerCase())?.deckRules.startingLife ?? 20;
      await getPlatform().server!.sendRoomMessage(
        createRoomRelayEnvelope({
          protocol: MANUAL_TABLETOP_RELAY_PROTOCOL,
          fromPlayer: `player-${myIndex}`,
          roomId: room.room_id,
          payload: {
            type: "launch",
            roomId: room.room_id,
            hostPlayer: username,
            playerOrder,
            startingLife,
            initialGameView,
          },
        }),
      );
      await startManualRoomHost(`player-${myIndex}`);
      navigate("/tabletop", {
        state: {
          manualTabletop: true,
          playerOrder,
          isHost: true,
          startingLife,
          myPlayerSlot: `player-${myIndex}`,
          initialGameView,
        },
      });
    } catch (error) {
      await endGame();
      toast.error(error instanceof Error ? error.message : "Failed to start tabletop.");
    }
  }

  function handleAddAiBot() {
    const room = currentRoom;
    if (!room || !username) return;
    if (room.players.length >= room.max_players) {
      toast.error("The room is full.");
      return;
    }
    const botName = `${username}-bot-${Date.now().toString(36)}`;
    setBotDeckTarget(botName);
    setAiDeckDialogOpen(true);
  }

  async function handleStartDraft() {
    const room = currentRoom;
    if (!room || !username) return;
    const config: DraftConfig | undefined = room.draft_config;
    if (!config) {
      toast.error("This room has no draft config — recreate it as a Draft room.");
      return;
    }
    setStartingLimited(true);
    try {
      const participants: DraftHostParticipant[] = room.players
        .filter((p) => p.username !== username)
        .map((p) => ({ playerSlot: p.username, displayName: p.username }));
      const ackPromise = awaitGameStartedAck(room.room_id);
      ackPromise.catch(() => {});
      try {
        await startGame("Draft");
        await ackPromise;
      } catch (e) {
        toast.error(`Failed to start draft: ${String(e)}`);
        return;
      }
      const result = await startDraftAsHost({
        roomId: room.room_id,
        hostSlot: username,
        hostName: username,
        participants,
        config: {
          setCode: config.set_code,
          cubeId: config.cube_id,
          cubeName: config.cube_name,
          podSize: room.max_players,
          rounds: config.rounds,
          picksPerPass: config.picks_per_pass,
          seed: config.seed,
          fillWithBots: config.fill_with_bots,
        },
      });
      if (!result.ok) {
        toast.error(`Failed to start draft: ${result.error}`);
        await useServerStore
          .getState()
          .endGame()
          .catch(() => {});
      }
    } finally {
      setStartingLimited(false);
    }
  }

  async function handleStartSealed() {
    const room = currentRoom;
    if (!room || !username) return;
    if (!room.sealed_config) {
      toast.error("This room has no sealed config — recreate it as a Sealed room.");
      return;
    }
    setStartingLimited(true);
    try {
      const ackPromise = awaitGameStartedAck(room.room_id);
      ackPromise.catch(() => {});
      try {
        await startGame("Sealed");
        await ackPromise;
      } catch (e) {
        toast.error(`Failed to start sealed: ${String(e)}`);
      }
    } finally {
      setStartingLimited(false);
    }
  }

  async function spawnBot(botName: string, deck: SelectedAiDeck) {
    const room = currentRoom;
    if (!room || !username || !getPlatform().server) return;
    try {
      await getPlatform().server!.spawnAiBot({
        roomId: room.room_id,
        roomPassword: roomPasswords[room.room_id] ?? null,
        username: botName,
        deckName: deck.name,
        deck: deck.deck,
        commanderName: deck.commanderName ?? null,
      });
      setMySpawnedBots((prev) => [...prev, botName]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to spawn bot.");
    }
  }

  async function handleRemoveBot(botName: string) {
    try {
      await getPlatform().server!.removeAiBot(botName);
      setMySpawnedBots((prev) => prev.filter((u) => u !== botName));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove bot.");
    }
  }

  async function handleSetMaxPlayers(maxPlayers: number) {
    try {
      await setMaxPlayers(maxPlayers);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to change player count.");
    }
  }

  return (
    <div className="h-full w-full flex">
      <div className="flex-1 min-w-0 flex flex-col mt-2">
        {/* ── Header ── */}
        <div className="px-4 h-14 shrink-0 flex items-center gap-3">
          {connected && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCreateRoomOpen(true)}
                disabled={currentRoom != null}
              >
                New Room
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={refreshLobbyData}
                disabled={refreshingLobby}
              >
                <RefreshCw className={cn("h-3 w-3 mr-1", refreshingLobby && "animate-spin")} />
                Refresh
              </Button>
            </div>
          )}

          <div className="flex-1" />

          <ReconnectBanner />

          {!connected && error && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() =>
                connect(
                  prefs.serverHost,
                  prefs.serverPort,
                  prefs.serverUsername,
                  prefs.serverPassword,
                )
              }
            >
              Retry
            </Button>
          )}
          {!connected && !connecting && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => navigate("/settings")}
            >
              <Settings className="h-3 w-3 mr-1" /> Settings
            </Button>
          )}
          {myUsername && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() =>
                isDesktop
                  ? setPlayersCollapsed((collapsed) => !collapsed)
                  : setPlayersDrawerOpen(true)
              }
              title={
                !isDesktop ? "Show players" : playersCollapsed ? "Show players" : "Hide players"
              }
            >
              {!isDesktop ? (
                <Users className="h-3.5 w-3.5" />
              ) : playersCollapsed ? (
                <PanelRightOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelRightClose className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>

        {/* ── Rooms ── */}
        <div className="flex-1 min-h-0">
          <TablesList
            rooms={rooms}
            currentRoom={currentRoom}
            roomPassword={roomPassword}
            username={username}
            onNewGame={() => setCreateRoomOpen(true)}
            onRefresh={refreshLobbyData}
            refreshing={refreshingLobby}
            refreshDisabled={!connected || connecting}
            onJoinRoom={handleJoinRoom}
            onLeaveRoom={leaveRoom}
            onSetReady={setReady}
            onSetFormat={setFormat}
            onSetMaxPlayers={handleSetMaxPlayers}
            onOpenDeckDialog={() => setDeckDialogOpen(true)}
            onStartGame={startGame}
            onStartTabletop={handleStartTabletop}
            onStartDraft={handleStartDraft}
            onStartSealed={handleStartSealed}
            startingLimited={startingLimited}
            onAddBot={handleAddAiBot}
            onRemoveBot={handleRemoveBot}
            mySpawnedBots={mySpawnedBots}
          />
        </div>
      </div>

      {myUsername && isDesktop && !playersCollapsed && (
        <div className="w-72 shrink-0 border-l h-full">
          <UserList
            players={players}
            rooms={rooms}
            currentRoom={currentRoom}
            currentPlayerId={playerId}
            currentUsername={myUsername}
            connectionState={connectionState}
            onJoinRoom={handleJoinRoom}
          />
        </div>
      )}

      {myUsername && !isDesktop && (
        <Sheet open={playersDrawerOpen} onOpenChange={setPlayersDrawerOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Players</SheetTitle>
            <UserList
              players={players}
              rooms={rooms}
              currentRoom={currentRoom}
              currentPlayerId={playerId}
              currentUsername={myUsername}
              connectionState={connectionState}
              onJoinRoom={handleJoinRoom}
            />
          </SheetContent>
        </Sheet>
      )}

      <CreateRoomDialog open={createRoomOpen} onOpenChange={setCreateRoomOpen} />
      <CreateGameDialog
        open={deckDialogOpen}
        onOpenChange={setDeckDialogOpen}
        mode="lobby"
        forcedFormatId={currentRoom?.format ? currentRoom.format.toLowerCase() : "standard"}
        onStart={(deck, _formatId, commanderName) => {
          void handleDeckSelection(deck.name, deck, commanderName);
        }}
      />
      <CreateGameDialog
        open={aiDeckDialogOpen}
        onOpenChange={(open) => {
          setAiDeckDialogOpen(open);
          if (!open) setBotDeckTarget(null);
        }}
        mode="lobby"
        forcedFormatId={currentRoom?.format ? currentRoom.format.toLowerCase() : "standard"}
        onStart={(deck, _formatId, commanderName) => {
          if (botDeckTarget) {
            void spawnBot(botDeckTarget, {
              name: deck.name,
              deck,
              commanderName,
            });
            setBotDeckTarget(null);
          }
        }}
      />
    </div>
  );
}
