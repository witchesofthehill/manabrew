import { Shield, Swords } from "lucide-react";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { TableRoomSidebar } from "@/components/lobby/TableRoomSidebar";
import { Button } from "@/components/ui/button";
import type { GameFormat, RoomInfo } from "@/types/server";

interface TableRoomProps {
  room: RoomInfo;
  roomPassword?: string | null;
  username: string | null;
  onLeaveRoom: () => void;
  onSetReady: (ready: boolean) => void;
  onSetFormat?: (format: GameFormat) => void;
  onSetMaxPlayers?: (maxPlayers: number) => void;
  onOpenDeckDialog: () => void;
  onStartGame: () => void;
  onStartDraft?: () => void;
  onStartSealed?: () => void;
  startingLimited?: boolean;
  startingGame?: boolean;
  onAddBot?: () => void;
  onRemoveBot?: (username: string) => void;
  mySpawnedBots?: string[];
}

export function TableRoom({
  room,
  roomPassword,
  username,
  onLeaveRoom,
  onSetReady,
  onSetFormat,
  onSetMaxPlayers,
  onOpenDeckDialog,
  onStartGame,
  onStartDraft,
  onStartSealed,
  startingLimited = false,
  startingGame = false,
  onAddBot,
  onRemoveBot,
  mySpawnedBots = [],
}: TableRoomProps) {
  const myPlayer = room.players.find((player) => player.username === username);
  const controllerName =
    room.players.find((player) => !player.is_bot)?.username ?? room.players[0]?.username;
  const isController = controllerName === username;
  const isLimitedRoom = !!(room.draft_config || room.sealed_config);
  const needsFormat = room.format === "Any" && !isLimitedRoom;
  const isOpenFormat = room.format === "Any" || isLimitedRoom;
  const minReady = isOpenFormat ? 1 : 2;
  const allOtherPlayersReady =
    room.players.length >= minReady &&
    room.players
      .filter((player) => player.username !== controllerName)
      .every((player) => player.ready);
  const controllerHasDeck =
    isLimitedRoom ||
    !!room.players.find((player) => player.username === controllerName)?.selected_deck_name;
  const canStart =
    room.status === "Lobby" && !needsFormat && allOtherPlayersReady && controllerHasDeck;
  const needsDeck = !isOpenFormat && !myPlayer?.selected_deck_name;
  const readyCount = room.players.filter(
    (player) => player.ready || player.username === controllerName,
  ).length;
  const openSeats = room.max_players - room.players.length;
  const requiredPlayers = Math.max(0, minReady - room.players.length);
  const modeLabel = room.draft_config
    ? (room.draft_config.cube_name ?? room.draft_config.set_code ?? "Draft")
    : room.sealed_config
      ? room.sealed_config.set_code
      : room.format;

  function renderPrimaryAction() {
    if (room.status !== "Lobby") {
      return (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-center sm:text-right">
          <p className="text-sm font-medium text-primary">Game in progress</p>
          <p className="text-xs text-muted-foreground">Opening the game table...</p>
        </div>
      );
    }
    if (needsFormat) {
      return (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-center sm:text-right">
          <p className="text-sm font-medium">Choose a format</p>
          <p className="text-xs text-muted-foreground">Select one in Table settings to continue.</p>
        </div>
      );
    }
    if (needsDeck) {
      return (
        <Button size="lg" onClick={onOpenDeckDialog} className="w-full sm:w-auto">
          <Shield /> Choose a deck
        </Button>
      );
    }
    if (!isController && myPlayer && !myPlayer.ready) {
      return (
        <Button size="lg" onClick={() => onSetReady(true)} className="w-full sm:w-auto">
          Ready up
        </Button>
      );
    }
    if (!isController && myPlayer?.ready) {
      return (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-center sm:text-right">
          <p className="text-sm font-medium text-primary">You're ready</p>
          <p className="text-xs text-muted-foreground">Waiting for the host to start.</p>
        </div>
      );
    }
    if (isController && canStart) {
      if (room.draft_config && onStartDraft) {
        return (
          <Button
            size="lg"
            onClick={onStartDraft}
            disabled={startingLimited}
            className="w-full sm:w-auto"
          >
            <Swords /> {startingLimited ? "Starting..." : "Start draft"}
          </Button>
        );
      }
      if (room.sealed_config && onStartSealed) {
        return (
          <Button
            size="lg"
            onClick={onStartSealed}
            disabled={startingLimited}
            className="w-full sm:w-auto"
          >
            <Swords /> {startingLimited ? "Starting..." : "Start sealed"}
          </Button>
        );
      }
      return (
        <Button
          size="lg"
          onClick={onStartGame}
          disabled={startingGame}
          className="w-full sm:w-auto"
        >
          <Swords /> {startingGame ? "Starting..." : "Start game"}
        </Button>
      );
    }
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-center sm:text-right">
        <p className="text-sm font-medium">
          {requiredPlayers > 0 ? `Waiting for ${requiredPlayers} more` : "Waiting for players"}
        </p>
        <p className="text-xs text-muted-foreground">
          {requiredPlayers > 0
            ? "Your table is open for others to join."
            : "Everyone at the table needs to be ready."}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="grid min-h-full gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-primary/30 bg-card/85 shadow-xl backdrop-blur-md">
          <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
            <OpenTableSeats
              players={room.players}
              maxPlayers={room.max_players}
              showSeatLabels
              openFormat={isOpenFormat}
              youUsername={username}
              removableBots={isController && room.status === "Lobby" ? mySpawnedBots : []}
              onRemoveBot={onRemoveBot}
              size="room"
              className="max-w-3xl"
              centerContent={
                <span className="flex flex-col items-center gap-1">
                  <span className="font-serif text-lg font-light text-foreground/90 sm:text-2xl">
                    {modeLabel}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                    {readyCount}/{room.players.length} ready
                  </span>
                </span>
              }
            />
          </div>
          <div className="flex flex-col gap-4 border-t border-border/60 bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your seat
              </p>
              <p className="mt-1 truncate text-sm font-medium">
                {isController
                  ? "You control when the game begins"
                  : isOpenFormat
                    ? myPlayer?.ready
                      ? "Ready to play"
                      : "Confirm when you're ready"
                    : (myPlayer?.selected_deck_name ?? "Choose the deck you want to play")}
              </p>
            </div>
            {renderPrimaryAction()}
          </div>
        </section>

        <TableRoomSidebar
          room={room}
          roomPassword={roomPassword}
          modeLabel={modeLabel}
          isController={isController}
          isLimitedRoom={isLimitedRoom}
          isOpenFormat={isOpenFormat}
          needsDeck={needsDeck}
          myPlayerReady={myPlayer?.ready === true}
          openSeats={openSeats}
          onLeaveRoom={onLeaveRoom}
          onSetReady={onSetReady}
          onSetFormat={onSetFormat}
          onSetMaxPlayers={onSetMaxPlayers}
          onOpenDeckDialog={onOpenDeckDialog}
          onAddBot={onAddBot}
        />
      </div>
    </div>
  );
}
