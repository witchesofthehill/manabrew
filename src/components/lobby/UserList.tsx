import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { JoinPasswordDialog } from "@/components/lobby/JoinPasswordDialog";
import { PLAYER_ROW_ACTION_CLASS, PlayerRow } from "@/components/lobby/PlayerRow";
import { useInviteStore } from "@/stores/useInviteStore";
import { Wifi, WifiOff, Loader2, Search, UserPlus } from "lucide-react";
import { USER_FACING_ERROR_MESSAGES } from "@/types/server";
import type { LocalGameKind, PlayerInfo, RoomInfo, ServerErrorCode } from "@/types/server";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";
import { toast } from "sonner";

export type ConnectionState = "connected" | "connecting" | "disconnected";

interface UserListProps {
  players: PlayerInfo[];
  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  currentPlayerId: string | null;
  currentUsername: string | null;
  connectionState: ConnectionState;
  onJoinRoom: (roomId: string, password?: string) => Promise<void>;
  invitesEnabled?: boolean;
}

const CONNECTION_STATUS: Record<
  ConnectionState,
  { dot: string; text: string; label: string; Icon: typeof Wifi }
> = {
  connected: { dot: "bg-success", text: "text-success", label: "Connected", Icon: Wifi },
  connecting: {
    dot: "bg-format-badge-amber",
    text: "text-muted-foreground",
    label: "Connecting…",
    Icon: Loader2,
  },
  disconnected: {
    dot: "bg-destructive",
    text: "text-destructive",
    label: "Disconnected",
    Icon: WifiOff,
  },
};

const LOCAL_GAME_LABEL: Record<LocalGameKind, string> = {
  Singleplayer: "Playing solo",
};

function playerStatus(room: RoomInfo | undefined, localGame?: LocalGameKind): string {
  if (!room) return localGame ? LOCAL_GAME_LABEL[localGame] : "Available";
  return room.status === "InGame" ? "In game" : "At a table";
}

// The relay should never surface one username twice, but a stale disconnected
// session can briefly linger alongside a live reconnect; collapse them here,
// keeping the connected entry.
function dedupePlayers(players: PlayerInfo[]): PlayerInfo[] {
  const byUsername = new Map<string, PlayerInfo>();
  for (const player of players) {
    const existing = byUsername.get(player.username);
    if (!existing || (!existing.connected && player.connected)) {
      byUsername.set(player.username, player);
    }
  }
  return [...byUsername.values()];
}

export function UserList({
  players,
  rooms,
  currentRoom,
  currentPlayerId,
  currentUsername,
  connectionState,
  onJoinRoom,
  invitesEnabled = false,
}: UserListProps) {
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const invited = useInviteStore((s) => s.sent);
  const sendInvite = useInviteStore((s) => s.send);
  const [passwordRoom, setPasswordRoom] = useState<RoomInfo | null>(null);
  const [search, setSearch] = useState("");

  const uniquePlayers = dedupePlayers(players);
  const myEntry = uniquePlayers.find(
    (p) =>
      (currentPlayerId != null && p.player_id === currentPlayerId) ||
      (currentUsername != null && p.username === currentUsername),
  );
  const others = uniquePlayers.filter(
    (p) =>
      (currentPlayerId == null || p.player_id !== currentPlayerId) &&
      (currentUsername == null || p.username !== currentUsername),
  );
  const myUsername = myEntry?.username ?? currentUsername;
  const status = CONNECTION_STATUS[connectionState];

  const normalizedSearch = search.trim().toLowerCase();
  const filteredOthers =
    normalizedSearch === ""
      ? others
      : others.filter((p) => stripUsernameTag(p.username).toLowerCase().includes(normalizedSearch));

  const bucketOf = (p: PlayerInfo): "playing" | "atTable" | "available" => {
    const room = rooms.find((r) => r.room_id === p.room_id);
    // A game on the player's own machine has no room behind it, so the relay
    // only knows about it because the client said so.
    if (!room) return p.local_game ? "playing" : "available";
    return room.status === "InGame" ? "playing" : "atTable";
  };
  const byName = (a: PlayerInfo, b: PlayerInfo) =>
    stripUsernameTag(a.username)
      .toLowerCase()
      .localeCompare(stripUsernameTag(b.username).toLowerCase());
  const playing = filteredOthers.filter((p) => bucketOf(p) === "playing").sort(byName);
  const atTable = filteredOthers.filter((p) => bucketOf(p) === "atTable").sort(byName);
  const available = filteredOthers.filter((p) => bucketOf(p) === "available").sort(byName);

  async function handleJoinRoom(roomId: string, password?: string) {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await onJoinRoom(roomId, password);
    } catch (error) {
      if (password) throw error;
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
    } else {
      void handleJoinRoom(room.room_id);
    }
  }

  const canInvite =
    invitesEnabled &&
    currentRoom != null &&
    currentRoom.status === "Lobby" &&
    currentRoom.players.length < currentRoom.max_players;

  function renderPlayer(player: PlayerInfo, isCurrentPlayer = false) {
    const room = rooms.find((r) => r.room_id === player.room_id);
    const joinable =
      !isCurrentPlayer &&
      room != null &&
      room.status === "Lobby" &&
      currentRoom == null &&
      room.players.length < room.max_players;
    const invitable =
      canInvite && !isCurrentPlayer && player.connected && room == null && !player.local_game;
    const statusLine = isCurrentPlayer ? (
      <span className={cn("flex items-center gap-1 text-[10px]", status.text)}>
        <status.Icon
          className={cn("h-2.5 w-3.5", connectionState === "connecting" && "animate-spin")}
        />
        {status.label}
      </span>
    ) : (
      <span className="text-[10px] text-muted-foreground" title={room?.room_name}>
        {playerStatus(room, player.local_game)}
      </span>
    );
    const action = joinable ? (
      <Button
        size="sm"
        variant="secondary"
        className={PLAYER_ROW_ACTION_CLASS}
        disabled={joiningRoomId === room.room_id}
        onClick={() => requestJoin(room)}
        title={`Join ${room.room_name}`}
      >
        {joiningRoomId === room.room_id ? "Joining…" : "Join"}
      </Button>
    ) : invitable ? (
      <Button
        size="sm"
        variant="secondary"
        className={PLAYER_ROW_ACTION_CLASS}
        disabled={invited.has(player.username)}
        onClick={() => void sendInvite(player.username)}
        title="Invite to your table"
      >
        <UserPlus className="h-3 w-3" />
        {invited.has(player.username) ? "Invited" : "Invite"}
      </Button>
    ) : null;
    return (
      <PlayerRow
        key={player.player_id}
        player={player}
        presenceDotClass={
          isCurrentPlayer ? status.dot : player.connected ? "bg-success" : "bg-muted-foreground/40"
        }
        status={statusLine}
        highlighted={isCurrentPlayer}
        action={action}
      />
    );
  }

  function renderSection(label: string, count: number, rows: PlayerInfo[]) {
    if (rows.length === 0) return null;
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="text-[10px] text-muted-foreground/70">{count}</span>
        </div>
        {rows.map((player) => renderPlayer(player))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 h-14 shrink-0 flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <status.Icon
              className={cn(
                "h-4 w-4 text-muted-foreground",
                connectionState === "connecting" && "animate-spin",
              )}
            />
          </TooltipTrigger>
          <TooltipContent>{status.label}</TooltipContent>
        </Tooltip>
        <h3 className="font-semibold text-sm">Players</h3>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {uniquePlayers.length}
        </span>
      </div>
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 pt-1 space-y-1">
          {myUsername &&
            renderPlayer(
              myEntry ?? {
                username: myUsername,
                player_id: "current-player",
                connected: connectionState === "connected",
              },
              true,
            )}
          {renderSection("Playing", playing.length, playing)}
          {renderSection("At a table", atTable.length, atTable)}
          {renderSection("Available", available.length, available)}

          {!myUsername && others.length === 0 && (
            <p className="text-xs text-muted-foreground italic text-center py-6">
              No players online
            </p>
          )}
          {myUsername && filteredOthers.length === 0 && normalizedSearch !== "" && (
            <p className="text-xs text-muted-foreground italic text-center py-6">
              No players match “{search.trim()}”
            </p>
          )}
        </div>
      </ScrollArea>

      <JoinPasswordDialog
        room={passwordRoom}
        onClose={() => setPasswordRoom(null)}
        onJoin={(room, password) => handleJoinRoom(room.room_id, password)}
      />
    </div>
  );
}
