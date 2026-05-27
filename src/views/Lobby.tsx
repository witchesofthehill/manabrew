import { TablesList } from "@/components/lobby/TablesList";
import { UserList } from "@/components/lobby/UserList";
import { ChatComponent } from "@/components/lobby/ChatComponent";
import { CreateRoomDialog } from "@/components/lobby/CreateRoomDialog";
import { CreateGameDialog } from "@/components/lobby/CreateGameDialog";
import { ReconnectBanner } from "@/components/lobby/ReconnectBanner";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useServerStore } from "@/stores/useServerStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { useGameStore } from "@/stores/useGameStore";
import { getFormat } from "@/lib/formats";
import { getPlatform } from "@/platform";
import type { RoomMessagePayload } from "@/types/server";
import type { Deck, GameView } from "@/types/manabrew";
import {
  MANUAL_TABLETOP_RELAY_PROTOCOL,
  createRoomRelayEnvelope,
  isRoomRelayProtocol,
} from "@/game";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff, Loader2, Settings, RefreshCw, MessageSquare, Users } from "lucide-react";

interface ManualTabletopLaunchPayload {
  type: "launch";
  roomId: string;
  hostPlayer: string;
  playerOrder: string[];
  startingLife: number;
  initialGameView: GameView;
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

function samePlayers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((player) => rightSet.has(player));
}

export default function Lobby() {
  const navigate = useNavigate();
  const {
    connected,
    connecting,
    error,
    username,
    rooms,
    currentRoom,
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
    startGame,
  } = useServerStore();
  const prefs = usePreferencesStore();
  const { currentDeck, savedDecks } = useDeckStore();
  const { startManualTabletopGame, startManualRoomHost, endGame } = useGameStore();
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [deckDialogOpen, setDeckDialogOpen] = useState(false);
  const [aiDeckDialogOpen, setAiDeckDialogOpen] = useState(false);
  const [refreshingLobby, setRefreshingLobby] = useState(false);
  const [sidePanel, setSidePanel] = useState<"chat" | "players" | null>(null);
  const [mySpawnedBots, setMySpawnedBots] = useState<string[]>([]);
  const [botDeckTarget, setBotDeckTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!connected && !connecting && prefs.serverUsername) {
      connect(prefs.serverHost, prefs.serverPort, prefs.serverUsername, prefs.serverPassword);
    }
  }, [
    connect,
    connected,
    connecting,
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
    if (gameStarted && playerOrder.length > 0) {
      const isHost = currentRoom?.host === username;
      if (
        currentRoom &&
        !samePlayers(
          playerOrder,
          currentRoom.players.map((player) => player.username),
        )
      ) {
        toast.error("Server player order does not match the current room.");
        return;
      }
      const myIndex = playerOrder.indexOf(username ?? "");
      if (myIndex < 0) {
        toast.error("Could not determine your player slot for this game.");
        return;
      }
      useServerStore.setState({ gameStarted: false });
      navigate("/play", {
        state: {
          multiplayer: true,
          playerOrder,
          playerDecks,
          isHost,
          startingLife,
          myPlayerSlot: `player-${myIndex}`,
        },
      });
    }
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

  async function handleDeckSelection(deckName: string, deck: Deck, commanderName?: string) {
    try {
      await setDeckSelection(deckName, deck, commanderName);
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

  async function spawnBot(botName: string, deck: SelectedAiDeck) {
    const room = currentRoom;
    if (!room || !username || !getPlatform().server) return;
    try {
      await getPlatform().server!.spawnAiBot({
        roomId: room.room_id,
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

  return (
    <div className="h-full w-full flex flex-col">
      {/* ── Header ── */}
      <div className="px-4 py-3 border-b shrink-0 flex items-center gap-3">
        <div className="flex-1" />

        <ReconnectBanner />

        {/* Connection status */}
        <div
          className={cn(
            "flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border",
            connected && "text-primary border-primary/30 bg-primary/5",
            !connected && error && "text-destructive border-destructive/30 bg-destructive/5",
            !connected && !error && "text-muted-foreground border-border",
          )}
        >
          {connecting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : connected ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span>
            {connecting
              ? "Connecting..."
              : connected
                ? username
                : error
                  ? "Disconnected"
                  : "Not connected"}
          </span>
        </div>

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

        {connected && (
          <div className="flex items-center gap-1">
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
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => setCreateRoomOpen(true)}
              disabled={currentRoom != null}
            >
              New Room
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button
              size="icon"
              variant={sidePanel === "chat" ? "secondary" : "ghost"}
              className="h-7 w-7 relative"
              title="Toggle chat"
              onClick={() => setSidePanel((v) => (v === "chat" ? null : "chat"))}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant={sidePanel === "players" ? "secondary" : "ghost"}
              className="h-7 w-7 relative"
              title="Toggle online players"
              onClick={() => setSidePanel((v) => (v === "players" ? null : "players"))}
            >
              <Users className="h-3.5 w-3.5" />
              {players.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[8px] rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {players.length}
                </span>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 min-h-0 flex">
        {/* Rooms — takes full width when panels are closed */}
        <div className="flex-1 min-w-0 h-full">
          {/* Hosted rooms are observer/AI-host rooms (e.g. the self-hosted
              node's) — not human PvP tables, so keep them out of the lobby
              browse list. The hosted "Play vs AI" flow still discovers them
              server-side. This is browse-only: a direct room ID could still be
              joined until forge-server enforces it (#30). */}
          <TablesList
            rooms={rooms.filter((room) => !room.hosted)}
            currentRoom={currentRoom}
            username={username}
            onNewGame={() => setCreateRoomOpen(true)}
            onRefresh={refreshLobbyData}
            refreshing={refreshingLobby}
            refreshDisabled={!connected || connecting}
            onJoinRoom={joinRoom}
            onLeaveRoom={leaveRoom}
            onSetReady={setReady}
            onOpenDeckDialog={() => setDeckDialogOpen(true)}
            onStartGame={startGame}
            onStartTabletop={handleStartTabletop}
            onAddBot={handleAddAiBot}
            onRemoveBot={handleRemoveBot}
            mySpawnedBots={mySpawnedBots}
          />
        </div>

        {/* Toggleable side panel */}
        {sidePanel && (
          <div className="w-72 shrink-0 border-l h-full">
            {sidePanel === "chat" && <ChatComponent channelId="Lobby" />}
            {sidePanel === "players" && <UserList players={players} />}
          </div>
        )}
      </div>

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
