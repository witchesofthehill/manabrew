import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hand, Users, Swords, Shield, LogOut, Bot, X } from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";
import type { RoomInfo } from "@/types/server";
import { cn } from "@/lib/utils";

interface TablesListProps {
  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  username: string | null;
  onNewGame: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshDisabled: boolean;
  onJoinRoom: (roomId: string) => Promise<void>;
  onLeaveRoom: () => void;
  onSetReady: (ready: boolean) => void;
  onOpenDeckDialog: () => void;
  onStartGame: () => void;
  onStartTabletop?: () => void;
  onAddBot?: () => void;
  onRemoveBot?: (username: string) => void;
  /** Bots this host process spawned — used to show the remove button. The
   *  relay has no isBot field; tracking lives client-local. */
  mySpawnedBots?: string[];
}

export function TablesList({
  rooms,
  currentRoom,
  username,
  onJoinRoom,
  onLeaveRoom,
  onSetReady,
  onOpenDeckDialog,
  onStartGame,
  onStartTabletop,
  onAddBot,
  onRemoveBot,
  mySpawnedBots = [],
}: TablesListProps) {
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  const inRoom = currentRoom != null;
  const myPlayer = currentRoom?.players.find((p) => p.username === username);
  const myPlayerHasDeck = !!myPlayer?.selected_deck_name;
  const isHost = currentRoom?.host === username;
  const allReady = currentRoom
    ? currentRoom.players.length >= 2 && currentRoom.players.every((p) => p.ready)
    : false;

  const orderedPlayers = currentRoom
    ? [...currentRoom.players].sort((a, b) => {
        if (a.username === currentRoom.host) return -1;
        if (b.username === currentRoom.host) return 1;
        return a.username.localeCompare(b.username);
      })
    : [];

  async function handleJoinRoom(roomId: string) {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await onJoinRoom(roomId);
    } finally {
      setJoiningRoomId(null);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Current room card */}
      {currentRoom && (
        <div className="p-4 border-b">
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Swords className="h-4 w-4 text-primary shrink-0" />
                <span className="font-semibold text-sm truncate">{currentRoom.room_name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="outline" className="text-[10px]">
                  {currentRoom.format}
                </Badge>
                <Badge
                  variant={currentRoom.status === "Lobby" ? "outline" : "secondary"}
                  className="text-[10px]"
                >
                  {currentRoom.status}
                </Badge>
              </div>
            </div>

            {/* Player slots */}
            <div className="grid gap-2 sm:grid-cols-2">
              {orderedPlayers.map((p) => {
                const canRemove = mySpawnedBots.includes(p.username);
                return (
                  <div
                    key={p.username}
                    className={cn(
                      "rounded-lg border px-3 py-2 flex items-center gap-2.5 transition-colors",
                      p.ready ? "border-primary/30 bg-primary/5" : "bg-muted/30",
                    )}
                  >
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        p.ready ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{p.username}</span>
                        {p.username === currentRoom.host && (
                          <GameIcon
                            name="overlord-helm"
                            className="h-3 w-3 text-commander shrink-0"
                          />
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.selected_deck_name ?? "No deck selected"}
                      </div>
                    </div>
                    {canRemove && isHost ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveBot?.(p.username)}
                        title="Remove bot"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Badge
                        variant={p.ready ? "default" : "outline"}
                        className={cn(
                          "text-[9px] px-1.5 shrink-0",
                          p.ready &&
                            "bg-primary border-primary text-primary-foreground hover:bg-primary",
                        )}
                      >
                        {p.ready ? "Ready" : "Waiting"}
                      </Badge>
                    )}
                  </div>
                );
              })}
              {/* Add Bot slot */}
              {isHost && currentRoom.players.length < currentRoom.max_players && onAddBot && (
                <button
                  className="rounded-lg border border-dashed px-3 py-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={onAddBot}
                >
                  <Bot className="h-3.5 w-3.5" />
                  Add Bot
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="outline" className="gap-1" onClick={onOpenDeckDialog}>
                <Shield className="h-3 w-3" /> Select Deck
              </Button>
              {myPlayer && !myPlayer.ready ? (
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => onSetReady(true)}
                  disabled={!myPlayerHasDeck}
                >
                  Ready Up
                </Button>
              ) : myPlayer?.ready ? (
                <Button size="sm" variant="outline" onClick={() => onSetReady(false)}>
                  Unready
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground"
                onClick={onLeaveRoom}
              >
                <LogOut className="h-3 w-3" /> Leave
              </Button>
              {isHost && (
                <div className="ml-auto flex items-center gap-2">
                  {onStartTabletop && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={onStartTabletop}
                      disabled={!allReady}
                    >
                      <Hand className="h-3 w-3" /> Tabletop
                    </Button>
                  )}
                  <Button size="sm" className="gap-1" onClick={onStartGame} disabled={!allReady}>
                    <Swords className="h-3 w-3" /> Start Game
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Room list */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-20">🎮</div>
              <p className="text-sm text-muted-foreground">No rooms available</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Create a new room to start playing
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rooms
                .filter((room) => room.status === "Lobby" || room.room_id === currentRoom?.room_id)
                .map((room) => {
                  const isMyRoom = room.room_id === currentRoom?.room_id;
                  const canJoin =
                    !inRoom && room.status === "Lobby" && room.players.length < room.max_players;
                  const isFull = room.players.length >= room.max_players;

                  return (
                    <div
                      key={room.room_id}
                      className={cn(
                        "rounded-lg border p-3 transition-colors",
                        isMyRoom && "border-primary/40 bg-primary/5",
                        !isMyRoom &&
                          canJoin &&
                          "hover:border-primary/30 hover:bg-muted/20 cursor-pointer",
                      )}
                      onClick={() => {
                        if (canJoin) void handleJoinRoom(room.room_id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{room.room_name}</div>
                          <div className="text-[11px] text-muted-foreground">by {room.host}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {room.hosted && (
                            <Badge variant="secondary" className="text-[10px]">
                              ManaBrew
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {room.engine === "Java" ? "Forge" : "Rust"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {room.format}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          <span>
                            {room.players.length}/{room.max_players}
                          </span>
                          <Badge
                            variant={room.status === "Lobby" ? "outline" : "secondary"}
                            className="text-[9px] ml-1"
                          >
                            {room.status === "InGame" ? "In Game" : room.status}
                          </Badge>
                        </div>

                        {isMyRoom ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Joined
                          </Badge>
                        ) : canJoin ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 text-[11px] px-2"
                            disabled={joiningRoomId === room.room_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleJoinRoom(room.room_id);
                            }}
                          >
                            {joiningRoomId === room.room_id ? "Joining..." : "Join"}
                          </Button>
                        ) : room.status === "InGame" ? (
                          <span className="text-[10px] text-muted-foreground">Playing</span>
                        ) : isFull ? (
                          <span className="text-[10px] text-muted-foreground">Full</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
