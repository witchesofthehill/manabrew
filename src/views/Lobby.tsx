import { TablesList } from "@/components/lobby/TablesList";
import { UserList, type ConnectionState } from "@/components/lobby/UserList";
import { TableSetup } from "@/components/lobby/TableSetup";
import { TableCreatingSplash } from "@/components/lobby/TableCreatingSplash";
import { CreateGameDialog } from "@/components/lobby/CreateGameDialog";
import { LeaveGameModal } from "@/components/game/modals";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIsDesktop } from "@/hooks/useBreakpoints";
import { useServerStore } from "@/stores/useServerStore";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { relayUsername } from "@/lib/relayUsername";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { startDraftAsHost, type DraftHostParticipant } from "@/game/draftHost";
import { buildEngineGameRouteState } from "@/game/engineGameLaunch";
import { startMpSealed } from "@/game/sealedStart";
import { getDeckFingerprint } from "@/lib/decks";
import { ROUTES } from "@/lib/constants";
import { stripUsernameTag } from "@/lib/username";
import { getPlatform } from "@/platform";
import { START_GAME_FAILURE_CODES } from "@/types/server";
import type {
  BotFailedPayload,
  DraftConfig,
  GameFormat,
  GameStartedPayload,
  ServerErrorCode,
  ServerErrorPayload,
} from "@/types/server";
import type { Deck } from "@/protocol/deck";
import { toast } from "sonner";
import { Settings, Users } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { findOrHostLanRelay, isUnreachable, type LanTarget } from "@/lib/lanRelay";

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

interface SelectedAiDeck {
  name: string;
  deck: Deck;
  commanderName?: string;
}

export default function Lobby() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const initialRouteState = location.state as {
    preferredSavedDeckId?: unknown;
    preferredHubDeckId?: unknown;
  } | null;
  const initialPreferredSavedDeckId =
    typeof initialRouteState?.preferredSavedDeckId === "string"
      ? initialRouteState.preferredSavedDeckId
      : undefined;
  const initialPreferredHubDeckId =
    typeof initialRouteState?.preferredHubDeckId === "string"
      ? initialRouteState.preferredHubDeckId
      : undefined;
  const {
    connected,
    connecting,
    error,
    username,
    playerId,
    rooms,
    currentRoom,
    roomPassword,
    hostingForgeRoom,
    players,
    gameStarted,
    gameRoomId,
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
  const accountHandle = useAuthStore((s) =>
    s.status === "signedIn" ? (s.account?.handle ?? null) : null,
  );
  const myUsername = username ?? relayUsername();
  const connectionState: ConnectionState = connected
    ? "connected"
    : connecting
      ? "connecting"
      : "disconnected";
  const savedDecks = useOwnedDecks();
  const [lanTarget, setLanTarget] = useState<LanTarget | null>(null);
  const lanTried = useRef(false);
  const lanDetail = lanTarget
    ? lanTarget.hosting
      ? "Hosting on your network"
      : `On your network · ${lanTarget.name ?? "nearby host"}`
    : undefined;
  const [settingUp, setSettingUp] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState<string | null>(null);
  const [preferredSavedDeckId] = useState(initialPreferredSavedDeckId);
  const [preferredHubDeckId] = useState(initialPreferredHubDeckId);
  const lastPlayedSavedDeck = savedDecks.find((saved) => saved.id === prefs.lastPlayedDeckId);
  const deckDialogPreSelectedId =
    preferredSavedDeckId ??
    (lastPlayedSavedDeck &&
    (lastPlayedSavedDeck.deck.format ?? "standard") ===
      (currentRoom?.format ? currentRoom.format.toLowerCase() : "standard")
      ? lastPlayedSavedDeck.id
      : undefined);
  const [deckDialogOpen, setDeckDialogOpen] = useState(false);
  const [aiDeckDialogOpen, setAiDeckDialogOpen] = useState(false);
  const [refreshingLobby, setRefreshingLobby] = useState(false);
  const [playersDrawerOpen, setPlayersDrawerOpen] = useState(false);
  const [mySpawnedBots, setMySpawnedBots] = useState<string[]>([]);
  const [botDeckTarget, setBotDeckTarget] = useState<string | null>(null);
  const [startingLimited, setStartingLimited] = useState(false);
  const [startingGame, setStartingGame] = useState(false);
  const [roomPasswords, setRoomPasswords] = useState<Record<string, string>>({});
  const [confirmLeaveHostedGame, setConfirmLeaveHostedGame] = useState(false);

  useEffect(() => {
    if (currentRoom) {
      setPlayersDrawerOpen(false);
      setSettingUp(false);
    }
  }, [currentRoom]);

  useEffect(() => {
    return getPlatform().events.on<BotFailedPayload>("server:bot_failed", (payload) => {
      setMySpawnedBots((prev) => prev.filter((name) => name !== payload.username));
      toast.error(`Bot couldn't join the table: ${payload.reason}`);
    });
  }, []);

  useEffect(() => {
    if (!initialPreferredSavedDeckId && !initialPreferredHubDeckId) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [initialPreferredHubDeckId, initialPreferredSavedDeckId, location.pathname, navigate]);

  // Leaving tears down the embedded Forge node (stopRoom), which kills the
  // game for everyone still playing — by design. Make the host confirm it.
  const handleLeaveRoom = () => {
    if (hostingForgeRoom && currentRoom?.status === "InGame") {
      setConfirmLeaveHostedGame(true);
      return;
    }
    void leaveRoom();
  };

  const draftMode = useMultiplayerDraftStore((s) => s.mode);
  const draftSessionId = useMultiplayerDraftStore((s) => s.sessionId);
  useEffect(() => {
    if (draftMode === "drafting" && draftSessionId) {
      navigate(`${ROUTES.DRAFT}/multiplayer`);
    }
  }, [draftMode, draftSessionId, navigate]);

  const sealedMode = useMultiplayerSealedStore((s) => s.mode);
  useEffect(() => {
    if (sealedMode === "building") {
      navigate(`${ROUTES.SEALED}/multiplayer`);
    }
  }, [sealedMode, navigate]);

  // Nobody answered where we were told to look. Somebody on this network may be
  // hosting, and if not, we can. Either way what comes back is an ordinary
  // relay and the rest of the lobby never learns which one it got.
  useEffect(() => {
    if (connected || connecting || !isUnreachable(error) || lanTried.current) return;
    const name = relayUsername();
    if (!name) return;
    lanTried.current = true;
    void findOrHostLanRelay().then((target) => {
      if (!target) return;
      setLanTarget(target);
      connect(target.host, target.port, name, target.password);
    });
  }, [connected, connecting, error, connect]);

  useEffect(() => {
    const name = relayUsername();
    if (!connected && !connecting && !error && name) {
      connect(prefs.serverHost, prefs.serverPort, name, prefs.serverPassword);
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
    accountHandle,
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
    if (!currentRoom) return;
    if (gameRoomId !== currentRoom.room_id) return;
    if (currentRoom?.draft_config) {
      useServerStore.setState({ gameStarted: false });
      return;
    }
    if (currentRoom?.sealed_config) {
      useServerStore.setState({ gameStarted: false });
      if (currentRoom.status === "InGame" && username) {
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
      useServerStore.setState({ gameStarted: false });
      toast.error(launch.error);
      if (currentRoom.host === username) {
        void useServerStore.getState().endGame();
      } else {
        void useServerStore.getState().leaveRoom();
      }
      return;
    }
    useServerStore.setState({ gameStarted: false });
    navigate(ROUTES.PLAY, { replace: true, state: launch.state });
  }, [
    gameStarted,
    gameRoomId,
    currentRoom,
    navigate,
    playerDecks,
    playerOrder,
    startingLife,
    username,
  ]);

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

  async function handleDeckSelection(
    deckName: string,
    deck: Deck,
    commanderName?: string,
    publishedDeckId?: string,
  ) {
    try {
      await setDeckSelection(deckName, deck, commanderName, publishedDeckId);
      const fingerprint = getDeckFingerprint(deck);
      const savedId = savedDecks.find(
        (saved) => getDeckFingerprint(saved.deck) === fingerprint,
      )?.id;
      if (savedId) prefs.setLastPlayedDeckId(savedId);
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

  function handleAddAiBot() {
    const room = currentRoom;
    if (!room || !username) return;
    if (room.players.length >= room.max_players) {
      toast.error("The room is full.");
      return;
    }
    const botName = `${stripUsernameTag(username)}-bot-${Date.now().toString(36)}`;
    setBotDeckTarget(botName);
    setAiDeckDialogOpen(true);
  }

  async function handleStartGame() {
    const room = currentRoom;
    if (!room || startingGame) return;
    setStartingGame(true);
    const ackPromise = awaitGameStartedAck(room.room_id);
    ackPromise.catch(() => {});
    try {
      await startGame();
      await ackPromise;
    } catch (e) {
      toast.error(`Failed to start game: ${String(e)}`);
    } finally {
      setStartingGame(false);
    }
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
        roomPassword: roomPasswords[room.room_id] ?? roomPassword ?? null,
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
    <div className="flex h-full w-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {!currentRoom && (!connected || (!isDesktop && !!myUsername)) && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 py-2 sm:px-6 lg:px-8">
            {!connected && error && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  connect(prefs.serverHost, prefs.serverPort, relayUsername(), prefs.serverPassword)
                }
              >
                Retry connection
              </Button>
            )}
            {!connected && !connecting && (
              <Button size="sm" variant="ghost" onClick={() => navigate(ROUTES.SETTINGS)}>
                <Settings /> Multiplayer settings
              </Button>
            )}
            {myUsername && (
              <Button
                size="sm"
                variant="ghost"
                className="md:hidden"
                onClick={() => setPlayersDrawerOpen(true)}
                title="Show players"
              >
                <Users /> Players
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {players.length}
                </span>
              </Button>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0">
          {settingUp && !currentRoom ? (
            <TableSetup
              username={myUsername}
              onClose={() => setSettingUp(false)}
              onCreatingChange={setCreatingLabel}
            />
          ) : creatingLabel ? (
            <TableCreatingSplash label={creatingLabel} />
          ) : (
            <TablesList
              rooms={rooms}
              currentRoom={currentRoom}
              roomPassword={roomPassword}
              username={username}
              onNewGame={() => setSettingUp(true)}
              onRefresh={refreshLobbyData}
              refreshing={refreshingLobby}
              refreshDisabled={!connected || connecting}
              disabled={!connected || connecting}
              onJoinRoom={handleJoinRoom}
              onLeaveRoom={handleLeaveRoom}
              onSetReady={setReady}
              onSetFormat={setFormat}
              onSetMaxPlayers={handleSetMaxPlayers}
              onOpenDeckDialog={() => setDeckDialogOpen(true)}
              onStartGame={handleStartGame}
              onStartDraft={handleStartDraft}
              onStartSealed={handleStartSealed}
              startingLimited={startingLimited}
              startingGame={startingGame}
              onAddBot={handleAddAiBot}
              onRemoveBot={handleRemoveBot}
              mySpawnedBots={mySpawnedBots}
            />
          )}
        </div>
      </div>

      {myUsername && (
        <aside className="hidden w-72 shrink-0 flex-col md:flex lg:w-80">
          <div className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/70 shadow-sm backdrop-blur-md">
            <UserList
              players={players}
              rooms={rooms}
              currentRoom={currentRoom}
              currentPlayerId={playerId}
              currentUsername={myUsername}
              connectionState={connectionState}
              connectionDetail={lanDetail}
              onJoinRoom={handleJoinRoom}
            />
          </div>
        </aside>
      )}

      {myUsername && !currentRoom && (
        <Sheet open={playersDrawerOpen} onOpenChange={setPlayersDrawerOpen}>
          <SheetContent side="right" className="w-80 max-w-[88vw] p-0 sm:w-96">
            <SheetTitle className="sr-only">Players</SheetTitle>
            <UserList
              players={players}
              rooms={rooms}
              currentRoom={currentRoom}
              currentPlayerId={playerId}
              currentUsername={myUsername}
              connectionState={connectionState}
              connectionDetail={lanDetail}
              onJoinRoom={handleJoinRoom}
            />
          </SheetContent>
        </Sheet>
      )}

      <CreateGameDialog
        open={deckDialogOpen}
        onOpenChange={setDeckDialogOpen}
        mode="lobby"
        engineKind={currentRoom?.engine}
        forcedFormatId={currentRoom?.format ? currentRoom.format.toLowerCase() : "standard"}
        preSelectedDeckId={deckDialogPreSelectedId}
        preSelectedHubDeckId={preferredHubDeckId}
        onStart={(deck, _formatId, commanderName, _playerCount, publishedDeckId) => {
          void handleDeckSelection(deck.name, deck, commanderName, publishedDeckId);
        }}
      />
      <CreateGameDialog
        open={aiDeckDialogOpen}
        onOpenChange={(open) => {
          setAiDeckDialogOpen(open);
          if (!open) setBotDeckTarget(null);
        }}
        mode="lobby"
        engineKind={currentRoom?.engine}
        forcedFormatId={currentRoom?.format ? currentRoom.format.toLowerCase() : "standard"}
        target="bot"
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
      {confirmLeaveHostedGame && (
        <LeaveGameModal
          onStay={() => setConfirmLeaveHostedGame(false)}
          onLeave={() => {
            setConfirmLeaveHostedGame(false);
            void leaveRoom();
          }}
        />
      )}
    </div>
  );
}
