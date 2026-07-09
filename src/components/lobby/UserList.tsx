import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JoinPasswordDialog } from "@/components/lobby/JoinPasswordDialog";
import { Wifi, WifiOff, Loader2, Search } from "lucide-react";
import type { PlayerInfo, RoomInfo } from "@/types/server";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";

export type ConnectionState = "connected" | "connecting" | "disconnected";

interface UserListProps {
  players: PlayerInfo[];
  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  currentPlayerId: string | null;
  currentUsername: string | null;
  connectionState: ConnectionState;
  onJoinRoom: (roomId: string, password?: string) => Promise<void>;
}

const CONNECTION_STATUS: Record<
  ConnectionState,
  { dot: string; text: string; label: string; Icon: typeof Wifi }
> = {
  connected: { dot: "bg-primary", text: "text-primary", label: "Connected", Icon: Wifi },
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

function playerStatus(room: RoomInfo | undefined): string {
  if (!room) return "Chilling";
  return room.status === "InGame" ? "In game" : "In lobby";
}

export function UserList({
  players,
  rooms,
  currentRoom,
  currentPlayerId,
  currentUsername,
  connectionState,
  onJoinRoom,
}: UserListProps) {
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [passwordRoom, setPasswordRoom] = useState<RoomInfo | null>(null);
  const [search, setSearch] = useState("");

  const myEntry = players.find(
    (p) =>
      (currentPlayerId != null && p.player_id === currentPlayerId) ||
      (currentUsername != null && p.username === currentUsername),
  );
  const others = players.filter((p) => p !== myEntry);
  const myUsername = myEntry?.username ?? currentUsername;
  const status = CONNECTION_STATUS[connectionState];

  const normalizedSearch = search.trim().toLowerCase();
  const filteredOthers =
    normalizedSearch === ""
      ? others
      : others.filter((p) => stripUsernameTag(p.username).toLowerCase().includes(normalizedSearch));

  const playing = filteredOthers.filter((p) => {
    const room = rooms.find((r) => r.room_id === p.room_id);
    return room?.status === "InGame";
  });
  const chilling = filteredOthers.filter((p) => {
    const room = rooms.find((r) => r.room_id === p.room_id);
    return room?.status !== "InGame";
  });

  async function handleJoinRoom(roomId: string, password?: string) {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await onJoinRoom(roomId, password);
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

  function renderPlayer(player: PlayerInfo) {
    const room = rooms.find((r) => r.room_id === player.room_id);
    const joinable =
      room != null &&
      room.status === "Lobby" &&
      currentRoom == null &&
      room.players.length < room.max_players;

    return (
      <div key={player.player_id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
        <div className="relative shrink-0">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[10px]">
              {stripUsernameTag(player.username).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
              player.connected ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium leading-none truncate block">
            {stripUsernameTag(player.username)}
          </span>
          <span className="text-[10px] text-muted-foreground" title={room?.room_name}>
            {playerStatus(room)}
          </span>
        </div>
        {joinable && (
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-[11px] shrink-0 hover:bg-primary hover:text-primary-foreground hover:shadow"
            disabled={joiningRoomId === room.room_id}
            onClick={() => requestJoin(room)}
            title={`Join ${room.room_name}`}
          >
            {joiningRoomId === room.room_id ? "Joining..." : "Join"}
          </Button>
        )}
      </div>
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
        {rows.map(renderPlayer)}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 h-14 border-b shrink-0 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Players</h3>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {players.length}
        </span>
      </div>
      <div className="p-2 shrink-0">
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
          {myUsername && (
            <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-muted/40">
              <div className="relative shrink-0">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-[10px]">
                    {myUsername.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
                    status.dot,
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium leading-none truncate block">
                  {myUsername && stripUsernameTag(myUsername)}{" "}
                  <span className="text-muted-foreground font-normal">(You)</span>
                </span>
                <span className={cn("flex items-center gap-1 text-[10px]", status.text)}>
                  <status.Icon
                    className={cn(
                      "h-2.5 w-2.5",
                      connectionState === "connecting" && "animate-spin",
                    )}
                  />
                  {status.label}
                </span>
              </div>
            </div>
          )}

          {renderSection("Playing", playing.length, playing)}
          {renderSection("Chilling", chilling.length, chilling)}

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
