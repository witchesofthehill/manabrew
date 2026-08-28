import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChooseFormatDialog } from "@/components/lobby/ChooseFormatDialog";
import { JoinPasswordDialog } from "@/components/lobby/JoinPasswordDialog";
import { MultiplayerStartPanel } from "@/components/lobby/MultiplayerStartPanel";
import { OpenTableCard } from "@/components/lobby/OpenTableCard";
import { TableRoom } from "@/components/lobby/TableRoom";
import { needsFormatChoice } from "@/components/lobby/tables.utils";
import { RefreshCw, Search } from "lucide-react";
import type { GameFormat, RoomInfo } from "@/types/server";
import { USER_FACING_ERROR_MESSAGES } from "@/types/server";
import type { ServerErrorCode } from "@/types/server";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const HIDDEN_ROOM_NAMES = new Set(["free room", "free pod"]);

interface TablesListProps {
  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  roomPassword?: string | null;
  username: string | null;
  onNewGame: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshDisabled: boolean;
  disabled?: boolean;
  onJoinRoom: (roomId: string, password?: string, format?: GameFormat) => Promise<void>;
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
  /** Bots this host process spawned — used to show the remove button. The
   *  relay has no isBot field; tracking lives client-local. */
  mySpawnedBots?: string[];
}

export function TablesList({
  rooms,
  currentRoom,
  roomPassword,
  username,
  onNewGame,
  onRefresh,
  refreshing,
  refreshDisabled,
  disabled = false,
  onJoinRoom,
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
}: TablesListProps) {
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [passwordRoom, setPasswordRoom] = useState<RoomInfo | null>(null);
  const [formatRoom, setFormatRoom] = useState<RoomInfo | null>(null);
  const [formatAfterJoin, setFormatAfterJoin] = useState(false);
  const [search, setSearch] = useState("");

  async function handleJoinRoom(roomId: string, password?: string, format?: GameFormat) {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await onJoinRoom(roomId, password, format);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const message = USER_FACING_ERROR_MESSAGES[code as ServerErrorCode];
      toast.error(message ?? "Couldn't join the table.");
    } finally {
      setJoiningRoomId(null);
    }
  }

  function requestJoin(room: RoomInfo) {
    if (room.password_protected) {
      setPasswordRoom(room);
    } else if (needsFormatChoice(room)) {
      setFormatAfterJoin(false);
      setFormatRoom(room);
    } else {
      void handleJoinRoom(room.room_id);
    }
  }

  async function joinThenChooseFormat(room: RoomInfo, password: string) {
    await onJoinRoom(room.room_id, password);
    if (needsFormatChoice(room)) {
      setFormatAfterJoin(true);
      setFormatRoom(room);
    }
  }

  const formatDialog = (
    <ChooseFormatDialog
      room={formatRoom}
      onClose={() => setFormatRoom(null)}
      onSelect={(room, format) => {
        if (formatAfterJoin) {
          onSetFormat?.(format);
        } else {
          void handleJoinRoom(room.room_id, undefined, format);
        }
      }}
    />
  );

  if (currentRoom) {
    return (
      <>
        <TableRoom
          room={currentRoom}
          roomPassword={roomPassword}
          username={username}
          onLeaveRoom={onLeaveRoom}
          onSetReady={onSetReady}
          onSetFormat={onSetFormat}
          onSetMaxPlayers={onSetMaxPlayers}
          onOpenDeckDialog={onOpenDeckDialog}
          onStartGame={onStartGame}
          onStartDraft={onStartDraft}
          onStartSealed={onStartSealed}
          startingLimited={startingLimited}
          startingGame={startingGame}
          onAddBot={onAddBot}
          onRemoveBot={onRemoveBot}
          mySpawnedBots={mySpawnedBots}
        />
        {formatDialog}
      </>
    );
  }

  const trimmedSearch = search.trim().toLowerCase();
  const ordinaryRooms = rooms
    .filter((room) => !HIDDEN_ROOM_NAMES.has(room.room_name.trim().toLowerCase()))
    .filter((room) => room.status === "Lobby")
    .filter((room) => !room.official || room.players.length > 0);
  const visibleRooms = ordinaryRooms.filter(
    (room) =>
      !trimmedSearch ||
      room.room_name.toLowerCase().includes(trimmedSearch) ||
      room.host.toLowerCase().includes(trimmedSearch),
  );
  const hasTables = ordinaryRooms.length > 0;

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-6 px-4 pb-6 pt-3 sm:px-6 lg:px-8">
          <MultiplayerStartPanel disabled={disabled} onSetUp={onNewGame} />

          <section className="space-y-3">
            <div>
              <h2 className="font-serif text-3xl font-light sm:text-4xl">
                Tables from other players
              </h2>
              <p className="ml-2 mt-2 text-xs text-muted-foreground">
                Join a table that is already waiting for players.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search tables"
                  placeholder="Search tables…"
                  className="h-8 pl-8 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
                />
              </div>
              <Button
                variant="outline"
                onClick={onRefresh}
                disabled={refreshDisabled || refreshing}
                title="Refresh tables"
                className="h-8 w-8 shrink-0 pointer-coarse:h-10 pointer-coarse:w-10"
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              </Button>
            </div>

            <p className="ml-2 text-xs text-muted-foreground">
              {visibleRooms.length} {visibleRooms.length === 1 ? "table" : "tables"}
            </p>

            {visibleRooms.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {visibleRooms.map((room) => (
                  <OpenTableCard
                    key={room.room_id}
                    room={room}
                    currentRoomId={null}
                    joining={joiningRoomId === room.room_id}
                    onJoin={requestJoin}
                  />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {hasTables
                  ? "No tables match your search."
                  : "No player tables waiting. Set one up above."}
              </p>
            )}
          </section>
        </div>
      </ScrollArea>

      <JoinPasswordDialog
        room={passwordRoom}
        onClose={() => setPasswordRoom(null)}
        onJoin={(room, password) => joinThenChooseFormat(room, password)}
      />

      {formatDialog}
    </div>
  );
}
